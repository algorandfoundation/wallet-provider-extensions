/**
 * @module client
 *
 * The drop-in **remote keystore engine**: it implements the whole
 * {@link KeyStore} contract by forwarding every call over a
 * {@link RemoteTransport} as JSON-RPC 2.0.
 *
 * Because it satisfies the same contract as an in-process engine, it is fully
 * interchangeable with one: pass it to a keystore extension via
 * `options.api.keystore` and the application drives a keystore living in
 * another process — or on another machine — exactly as if it owned it locally.
 * The responder's `state` notifications keep the injected reactive `store`
 * hydrated, so the provider's reactive `keys`/`algorithms` work remotely too.
 */

import type {
  DeriveOptions,
  ExportOptions,
  GenerateOptions,
  Key,
  KeyData,
  KeyFormat,
  KeyId,
  KeyOptions,
  KeyStoreState,
  SecretOptions,
  SecretStoreAPI,
} from "@algorandfoundation/keystore-core";

import {
  decodeFrame,
  decodeValue,
  encodeFrame,
  encodeValue,
  JSON_RPC_VERSION,
  type RpcMethod,
  type RpcNotification,
  type RpcResponse,
  RPC_STATE_METHOD,
} from "./protocol.ts";
import type { RemoteChannel, RemoteKeyStore, RemoteKeyStoreOptions } from "./types.ts";

/** A pending in-flight request awaiting its correlated response. */
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Creates a drop-in keystore backed by a remote one.
 *
 * The engine opens the transport immediately; `ready` resolves once the first
 * `state` snapshot has hydrated `options.store` (which also proves the link is
 * up) and rejects if the link fails before that. Every API call is forwarded
 * and its result decoded back — byte payloads round-trip transparently, and the
 * optional per-operation context travels with the call. Optional API methods
 * (`clear`, `importSeed`, `secrets`, …) are always present on the client; if
 * the hosted keystore does not support one, the call rejects with the
 * responder's error message rather than silently doing nothing.
 *
 * @param options - {@link RemoteKeyStoreOptions}.
 * @returns A {@link RemoteKeyStore}.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createRemoteKeyStore, createWebSocketTransport } from "@algorandfoundation/keystore-remote";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createRemoteKeyStore({
 *   store,
 *   transport: createWebSocketTransport({ url: "ws://127.0.0.1:7413" }),
 * });
 * await keystore.ready;
 * const signature = await keystore.sign(store.state.keys[0].id, new TextEncoder().encode("hi"));
 * await keystore.close();
 * ```
 */
export function createRemoteKeyStore(options: RemoteKeyStoreOptions): RemoteKeyStore {
  const { store } = options;

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let readySettled = false;

  /** Rejects `ready` (when still pending) and every in-flight call. */
  const failAll = (error: Error): void => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    for (const [, entry] of pending) {
      entry.reject(error);
    }
    pending.clear();
  };

  const channel: RemoteChannel = options.transport({
    message(frame: string): void {
      let message;
      try {
        message = decodeFrame(frame);
      } catch {
        // Ignore an unparseable frame rather than tear down the session.
        return;
      }
      if (message === undefined) return;
      if ("id" in message && typeof message.id === "number") {
        const response = message as RpcResponse;
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        if (response.error) {
          entry.reject(new Error(response.error.message));
        } else {
          entry.resolve(decodeValue(response.result));
        }
      } else if ("method" in message && message.method === RPC_STATE_METHOD) {
        const notification = message as RpcNotification;
        const state = decodeValue(notification.params[0]) as KeyStoreState;
        store.setState(() => state);
        if (!readySettled) {
          readySettled = true;
          resolveReady();
        }
      }
    },
    close(error?: Error): void {
      if (!closed) failAll(error ?? new Error("remote keystore connection closed"));
    },
  });

  /** Sends a request and resolves with its decoded result. */
  const call = <T>(method: RpcMethod, args: unknown[]): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error("remote keystore client is closed"));
    }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      channel.send(
        encodeFrame({
          jsonrpc: JSON_RPC_VERSION,
          id,
          method,
          params: (args ?? []).map(encodeValue),
        }),
      );
    });
  };

  const secrets: SecretStoreAPI<unknown> = {
    put: (value: Uint8Array | string, secretOptions?: SecretOptions, ctx?: unknown) =>
      call<KeyId>("secrets.put", [value, secretOptions, ctx]),
    get: (id: KeyId, ctx?: unknown) => call<Uint8Array>("secrets.get", [id, ctx]),
    list: () => call<Key[]>("secrets.list", []),
    remove: (id: KeyId, ctx?: unknown) => call<void>("secrets.remove", [id, ctx]),
  };

  return {
    ready,
    async close(): Promise<void> {
      closed = true;
      channel.close();
      for (const [, entry] of pending) {
        entry.reject(new Error("remote keystore client is closed"));
      }
      pending.clear();
    },

    generate: (generateOptions: GenerateOptions, ctx?: unknown) =>
      call<KeyId>("generate", [generateOptions, ctx]),
    import: (
      data: (Omit<KeyData, "id"> & { id?: KeyId }) | Uint8Array | string,
      format?: KeyFormat,
      ctx?: unknown,
    ) => call<KeyId>("import", [data, format, ctx]),
    export: (id: KeyId, exportOptions?: ExportOptions, ctx?: unknown) =>
      call<KeyData>("export", [id, exportOptions, ctx]),
    remove: (id: KeyId, ctx?: unknown) => call<void>("remove", [id, ctx]),
    clear: (ctx?: unknown) => call<void>("clear", [ctx]),
    sign: (id: KeyId, data: Uint8Array, algorithm?: string, ctx?: unknown) =>
      call<Uint8Array>("sign", [id, data, algorithm, ctx]),
    verify: (id: KeyId, data: Uint8Array, signature: Uint8Array, algorithm?: string) =>
      call<boolean>("verify", [id, data, signature, algorithm]),
    encryptWithKey: (id: KeyId, data: Uint8Array, algorithm?: string, ctx?: unknown) =>
      call<Uint8Array>("encryptWithKey", [id, data, algorithm, ctx]),
    decryptWithKey: (id: KeyId, data: Uint8Array, algorithm?: string, ctx?: unknown) =>
      call<Uint8Array>("decryptWithKey", [id, data, algorithm, ctx]),
    deriveSharedSecret: (
      id: KeyId,
      publicKey: Uint8Array,
      meFirst: boolean,
      algorithm?: string,
      ctx?: unknown,
    ) => call<Uint8Array>("deriveSharedSecret", [id, publicKey, meFirst, algorithm, ctx]),
    importSeed: (seed: Uint8Array, seedOptions?: KeyOptions, ctx?: unknown) =>
      call<KeyId>("importSeed", [seed, seedOptions, ctx]),
    deriveFromSeed: (seedId: KeyId, path: string, deriveOptions?: DeriveOptions, ctx?: unknown) =>
      call<KeyId>("deriveFromSeed", [seedId, path, deriveOptions, ctx]),
    deriveDomainKey: (mainKeyId: KeyId, deriveOptions: DeriveOptions, ctx?: unknown) =>
      call<KeyId>("deriveDomainKey", [mainKeyId, deriveOptions, ctx]),
    batchSign: (ids: KeyId[], data: Uint8Array[], ctx?: unknown) =>
      call<Uint8Array[]>("batchSign", [ids, data, ctx]),
    secrets,
  };
}
