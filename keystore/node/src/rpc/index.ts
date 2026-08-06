/**
 * @module rpc
 *
 * The Node keystore RPC surface: a JSON-RPC 2.0 service over a local socket that
 * hosts a {@link import("../engine.ts").createNodeKeyStore} keystore, and a
 * drop-in client engine third parties use to drive it as if it were in-process.
 *
 * - {@link createKeyStoreRpcServer} — run (by the `keystore serve` CLI) to expose
 *   a keystore to other processes.
 * - {@link createRpcKeyStore} — a `KeyStore` client that forwards every call over
 *   the socket; plug it into the extension via `options.api.keystore`.
 * - {@link defaultRpcSocketPath} — the shared default socket path both ends use.
 */

export { createRpcKeyStore, type RpcKeyStore, type RpcKeyStoreOptions } from "./client.ts";
export {
  createKeyStoreRpcServer,
  type KeyStoreRpcServer,
  type KeyStoreRpcServerOptions,
} from "./server.ts";
export { defaultRpcSocketPath, isRpcMethod, RPC_METHODS, type RpcMethod } from "./protocol.ts";
