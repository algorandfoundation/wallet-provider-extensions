/**
 * @module rpc/client
 *
 * The drop-in keystore RPC **client engine** for a local socket.
 *
 * It is the transport-neutral
 * {@link import("@algorandfoundation/keystore-remote").createRemoteKeyStore}
 * engine bound to the {@link createSocketTransport local-socket transport}:
 * every call is forwarded to a running
 * {@link import("./server.ts").createKeyStoreRpcServer service} as JSON-RPC 2.0
 * and the whole {@link KeyStore} contract is implemented.
 *
 * Because it satisfies the same contract, it is fully interchangeable with the
 * in-process {@link import("../engine.ts").createNodeKeyStore} engine: pass it
 * to the Node keystore extension via `options.api.keystore` and a third-party
 * process talks to the shared keystore exactly as if it owned it. Server
 * `state` notifications keep the injected reactive `store` hydrated, so the
 * provider's reactive `keys`/`algorithms` work remotely too.
 *
 * To reach a daemon that is *not* on this machine, keep this engine and swap
 * the transport for
 * {@link import("@algorandfoundation/keystore-remote").createWebSocketTransport}.
 */

import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import { createRemoteKeyStore, type RemoteKeyStore } from "@algorandfoundation/keystore-remote";
import type { Store } from "@tanstack/store";

import { createSocketTransport } from "./socket.ts";

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
   * {@link import("./protocol.ts").defaultRpcSocketPath} (must match the
   * server's).
   */
  path?: string;
}

/**
 * The RPC client engine: a {@link KeyStore} whose every operation is forwarded
 * to a remote service, plus a `close` to drop the connection.
 */
export type RpcKeyStore = RemoteKeyStore;

/**
 * Creates a drop-in keystore backed by a keystore service on this machine.
 *
 * The engine connects lazily; `ready` resolves once the connection is
 * established and the first `state` snapshot has hydrated `options.store`.
 * Every API call is forwarded over the socket and its result decoded back (byte
 * payloads round-trip transparently). Optional API methods (`clear`,
 * `importSeed`, `deriveFromSeed`, `secrets`, …) are always present on the
 * client; if the hosted keystore does not support one, the call rejects with
 * the server's error message.
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
  return createRemoteKeyStore({
    store: options.store,
    transport: createSocketTransport(options.path === undefined ? {} : { path: options.path }),
  });
}
