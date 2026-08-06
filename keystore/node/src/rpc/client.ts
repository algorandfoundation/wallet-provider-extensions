/**
 * @module rpc/client
 *
 * The drop-in keystore RPC **client engine**: it connects to a running
 * {@link import("./server.ts").createKeyStoreRpcServer service} over a local
 * socket and forwards every call as JSON-RPC 2.0, implementing the full
 * {@link KeyStore} contract (a `KeyStoreAPI` plus a `ready` promise).
 *
 * Because it satisfies `KeyStore<void>`, it is fully interchangeable with the
 * in-process {@link import("../engine.ts").createNodeKeyStore} engine: pass it to
 * the Node keystore extension via `options.api.keystore` and a third-party
 * process talks to the shared keystore exactly as if it owned it locally. Server
 * `state` notifications keep the injected reactive `store` hydrated, so the
 * provider's reactive `keys`/`algorithms` work remotely too.
 */

import { createConnection, type Socket } from "node:net";

import type {
  DeriveOptions,
  ExportOptions,
  GenerateOptions,
  Key,
  KeyData,
  KeyFormat,
  KeyId,
  KeyOptions,
  KeyStore,
  KeyStoreState,
  SecretOptions,
  SecretStoreAPI,
} from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

import {
  createFrameDecoder,
  decodeValue,
  defaultRpcSocketPath,
  encodeFrame,
  encodeValue,
  JSON_RPC_VERSION,
  type RpcMethod,
  type RpcNotification,
  type RpcResponse,
  RPC_STATE_METHOD,
} from "./protocol.ts";

/** Options for {@link createRpcKeyStore}. */
export interface RpcKeyStoreOptions {
  /**
   * The reactive store to keep hydrated from the server's `state` pushes. Pass
   * the same store you would hand any other engine so the provider's reactive
   * `keys`/`status`/`algorithms` reflect the remote keystore.
   */
  store: Store<KeyStoreState>;
  /**
   * The socket path / named pipe of the running service. Defaults to
   * {@link defaultRpcSocketPath} (must match the server's).
   */
  path?: string;
}

/**
 * The RPC client engine: a {@link KeyStore} whose every operation is forwarded
 * to a remote service, plus a {@link close} to drop the connection.
 */
export type RpcKeyStore = KeyStore<void> & {
  /** Disconnects from the service. Pending calls reject. */
  close(): Promise<void>;
};

/** A pending in-flight request awaiting its correlated response. */
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Creates a drop-in keystore backed by a remote RPC service.
 *
 * The returned engine connects lazily; `ready` resolves once the connection is
 * established and the first `state` snapshot has hydrated `options.store`. Every
 * API call is forwarded over the socket and its result decoded back (byte
 * payloads round-trip transparently). Optional API methods (`clear`,
 * `importSeed`, `deriveFromSeed`, `secrets`, …) are always present on the client;
 * if the hosted keystore does not support one, the call rejects with the
 * server's error message.
 *
 * @param options - {@link RpcKeyStoreOptions}.
 * @returns An {@link RpcKeyStore}.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createRpcKeyStore } from "@algorandfoundation/keystore-node";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createRpcKeyStore({ store });
 * await keystore.ready;
 * const id = await keystore.generate({
 *   type: "ed25519",
 *   algorithm: "EdDSA",
 *   extractable: false,
 *   keyUsages: ["sign", "verify"],
 * });
 * const signature = await keystore.sign(id, new TextEncoder().encode("hi"));
 * await keystore.close();
 * ```
 */
export function createRpcKeyStore(options: RpcKeyStoreOptions): RpcKeyStore {
  const socketPath = options.path ?? defaultRpcSocketPath();
  const { store } = options;

  const pending = new Map<number, Pending>();
  const decoder = createFrameDecoder();
  let nextId = 1;
  let closed = false;

  const socket: Socket = createConnection(socketPath);
  socket.setNoDelay(true);

  // `ready` resolves on the first state snapshot (which also proves the
  // connection is up); a connection error before then rejects it.
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let readySettled = false;

  const failAll = (error: Error): void => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    for (const [, p] of pending) {
      p.reject(error);
    }
    pending.clear();
  };

  socket.on("data", (chunk: Buffer) => {
    let messages;
    try {
      messages = decoder.push(chunk);
    } catch {
      return;
    }
    for (const message of messages) {
      if ("id" in message && typeof message.id === "number") {
        const response = message as RpcResponse;
        const entry = pending.get(response.id);
        if (!entry) continue;
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
    }
  });

  socket.on("error", (error: Error) => failAll(error));
  socket.on("close", () => {
    if (!closed) failAll(new Error("keystore RPC connection closed"));
  });

  /** Sends a request and resolves with its decoded result. */
  const call = <T>(method: RpcMethod, args: unknown[]): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error("keystore RPC client is closed"));
    }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.write(
        encodeFrame({
          jsonrpc: JSON_RPC_VERSION,
          id,
          method,
          params: (args ?? []).map(encodeValue),
        }),
      );
    });
  };

  const secrets: SecretStoreAPI<void> = {
    put: (value: Uint8Array | string, secretOptions?: SecretOptions) =>
      call<KeyId>("secrets.put", [value, secretOptions]),
    get: (id: KeyId) => call<Uint8Array>("secrets.get", [id]),
    list: () => call<Key[]>("secrets.list", []),
    remove: (id: KeyId) => call<void>("secrets.remove", [id]),
  };

  return {
    ready,
    async close(): Promise<void> {
      closed = true;
      socket.destroy();
      for (const [, p] of pending) {
        p.reject(new Error("keystore RPC client is closed"));
      }
      pending.clear();
    },

    generate: (generateOptions: GenerateOptions) => call<KeyId>("generate", [generateOptions]),
    import: (
      data: (Omit<KeyData, "id"> & { id?: KeyId }) | Uint8Array | string,
      format?: KeyFormat,
    ) => call<KeyId>("import", [data, format]),
    export: (id: KeyId, exportOptions?: ExportOptions) =>
      call<KeyData>("export", [id, exportOptions]),
    remove: (id: KeyId) => call<void>("remove", [id]),
    clear: () => call<void>("clear", []),
    sign: (id: KeyId, data: Uint8Array, algorithm?: string) =>
      call<Uint8Array>("sign", [id, data, algorithm]),
    verify: (id: KeyId, data: Uint8Array, signature: Uint8Array, algorithm?: string) =>
      call<boolean>("verify", [id, data, signature, algorithm]),
    encryptWithKey: (id: KeyId, data: Uint8Array, algorithm?: string) =>
      call<Uint8Array>("encryptWithKey", [id, data, algorithm]),
    decryptWithKey: (id: KeyId, data: Uint8Array, algorithm?: string) =>
      call<Uint8Array>("decryptWithKey", [id, data, algorithm]),
    deriveSharedSecret: (id: KeyId, publicKey: Uint8Array, meFirst: boolean, algorithm?: string) =>
      call<Uint8Array>("deriveSharedSecret", [id, publicKey, meFirst, algorithm]),
    importSeed: (seed: Uint8Array, seedOptions?: KeyOptions) =>
      call<KeyId>("importSeed", [seed, seedOptions]),
    deriveFromSeed: (seedId: KeyId, path: string, deriveOptions?: DeriveOptions) =>
      call<KeyId>("deriveFromSeed", [seedId, path, deriveOptions]),
    deriveDomainKey: (mainKeyId: KeyId, deriveOptions: DeriveOptions) =>
      call<KeyId>("deriveDomainKey", [mainKeyId, deriveOptions]),
    batchSign: (ids: KeyId[], data: Uint8Array[]) => call<Uint8Array[]>("batchSign", [ids, data]),
    secrets,
  };
}
