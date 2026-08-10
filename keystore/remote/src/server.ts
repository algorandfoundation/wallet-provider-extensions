/**
 * @module server
 *
 * The **responder**: the server half of a remote keystore session, with no
 * transport of its own.
 *
 * It hosts an already-built {@link KeyStore} and answers the JSON-RPC 2.0
 * protocol of {@link import("./protocol.ts")} on any
 * {@link import("./types.ts").RemoteChannel} handed to it, so the same hosting
 * logic serves a Unix domain socket, a WebSocket or an in-memory test loopback.
 * A host (see `@algorandfoundation/keystore-node`) only has to accept
 * connections, adapt each one to a channel, and feed received frames into the
 * returned {@link RemoteSession}.
 *
 * Every request is dispatched against the method allow-list
 * ({@link RPC_METHODS}); the whole keystore surface is exposed. On connect, and
 * on every reactive-store change thereafter, the current
 * {@link import("@algorandfoundation/keystore-core").KeyStoreState} is pushed
 * as a `state` notification so remote clients stay hydrated without polling.
 */

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

import {
  decodeFrame,
  decodeValue,
  encodeFrame,
  encodeValue,
  isRpcMethod,
  JSON_RPC_VERSION,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
  RpcErrorCode,
  RPC_STATE_METHOD,
} from "./protocol.ts";
import type {
  KeyStoreResponder,
  KeyStoreResponderOptions,
  RemoteChannel,
  RemoteSession,
} from "./types.ts";

/**
 * Invokes a single allow-listed keystore method with already-decoded arguments.
 * The `secrets.*` names dispatch into the {@link KeyStore.secrets} namespace;
 * `state` is answered from the reactive store. Missing optional methods throw a
 * descriptive error that is surfaced to the client.
 */
async function invokeMethod(
  keystore: KeyStore<never>,
  store: Store<KeyStoreState>,
  method: RpcMethod,
  args: unknown[],
): Promise<unknown> {
  if (method === "state") {
    return store.state;
  }
  if (method.startsWith("secrets.")) {
    const secrets = keystore.secrets;
    if (!secrets) {
      throw new Error("this keystore does not support secrets");
    }
    const name = method.slice("secrets.".length);
    const fn = (secrets as unknown as Record<string, unknown>)[name];
    if (typeof fn !== "function") {
      throw new Error(`unknown secrets operation: ${name}`);
    }
    return (fn as (...a: unknown[]) => Promise<unknown>).apply(secrets, args);
  }
  const fn = (keystore as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    throw new Error(`operation not supported by this keystore: ${method}`);
  }
  return (fn as (...a: unknown[]) => Promise<unknown>).apply(keystore, args);
}

/**
 * Handles one request: validates the method, decodes the args, invokes the
 * keystore and writes back an encoded result or a JSON-RPC error.
 */
async function handleRequest(
  request: RpcRequest,
  channel: RemoteChannel,
  keystore: KeyStore<never>,
  store: Store<KeyStoreState>,
): Promise<void> {
  const write = (response: RpcResponse): void => {
    channel.send(encodeFrame(response));
  };

  if (!isRpcMethod(request.method)) {
    write({
      jsonrpc: JSON_RPC_VERSION,
      id: request.id,
      error: { code: RpcErrorCode.methodNotFound, message: `unknown method: ${request.method}` },
    });
    return;
  }

  try {
    const args = request.params.map(decodeValue);
    const result = await invokeMethod(keystore, store, request.method, args);
    write({ jsonrpc: JSON_RPC_VERSION, id: request.id, result: encodeValue(result) });
  } catch (error) {
    write({
      jsonrpc: JSON_RPC_VERSION,
      id: request.id,
      error: {
        code: RpcErrorCode.operationFailed,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Creates a transport-neutral host for `options.keystore`.
 *
 * The responder is inert until {@link KeyStoreResponder.open} is called with a
 * connected peer's channel; each call yields an independent
 * {@link RemoteSession} with its own reactive-store subscription.
 *
 * @param options - {@link KeyStoreResponderOptions}.
 * @returns A {@link KeyStoreResponder}.
 *
 * @example
 * ```typescript
 * const responder = createKeyStoreResponder({ keystore, store });
 * const session = responder.open({ send: (frame) => socket.write(frame), close: () => socket.end() });
 * socket.on("data", (chunk) => session.receive(chunk.toString("utf8")));
 * socket.on("close", () => session.close());
 * ```
 */
export function createKeyStoreResponder(options: KeyStoreResponderOptions): KeyStoreResponder {
  const { keystore, store } = options;

  return {
    open(channel: RemoteChannel): RemoteSession {
      let unsubscribe: (() => void) | undefined;
      let open = true;

      // Push the current state on connect, then on every subsequent change, so
      // a client engine can keep its reactive store hydrated without polling.
      const sendState = (): void => {
        if (!open) return;
        channel.send(
          encodeFrame({
            jsonrpc: JSON_RPC_VERSION,
            method: RPC_STATE_METHOD,
            params: [encodeValue(store.state)],
          }),
        );
      };

      keystore.ready
        .then(() => {
          if (!open) return;
          sendState();
          // TanStack Store's `subscribe` returns a `Subscription`; normalize it
          // to a plain unsubscribe callback for cleanup on disconnect.
          const subscription = store.subscribe(sendState);
          unsubscribe = () => subscription.unsubscribe();
        })
        .catch(() => {
          // A failed `ready` still surfaces per-request; nothing to push here.
        });

      return {
        receive(frame: string): void {
          let message;
          try {
            message = decodeFrame(frame);
          } catch {
            // Ignore an unparseable frame rather than tear down the session.
            return;
          }
          if (message === undefined) return;
          if ("id" in message && typeof message.id === "number" && "method" in message) {
            void handleRequest(message as RpcRequest, channel, keystore, store);
          }
        },
        close(): void {
          open = false;
          unsubscribe?.();
          unsubscribe = undefined;
        },
      };
    },
  };
}
