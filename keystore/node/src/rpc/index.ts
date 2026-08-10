/**
 * @module rpc
 *
 * The Node keystore RPC surface: a JSON-RPC 2.0 service that hosts a
 * {@link import("../engine.ts").createNodeKeyStore} keystore (or any other),
 * and a drop-in client engine third parties use to drive it as if it were
 * in-process.
 *
 * Two doors lead to the same keystore, and the choice is only a transport:
 *
 * - {@link createKeyStoreRpcServer} / {@link createRpcKeyStore} — a **local
 *   socket** (Unix domain socket or named pipe). No port is opened; access is
 *   gated by filesystem permissions.
 * - {@link createKeyStoreWebSocketServer} plus
 *   {@link import("@algorandfoundation/keystore-remote").createWebSocketTransport}
 *   — a **WebSocket**, so a remote consumer (a wallet, a web page) can reach
 *   the daemon.
 *
 * The protocol, the client engine and the responder they all share are the pure
 * [`@algorandfoundation/keystore-remote`](../../../remote/README.md) package.
 */

export {
  WithRemoteKeyStore,
  withRemoteKeyStoreAt,
  type RemoteKeyStoreBlock,
  type RemoteKeystoreOptions,
} from "@algorandfoundation/keystore-remote";
export { createRpcKeyStore, type RpcKeyStore, type RpcKeyStoreOptions } from "./client.ts";
export {
  createKeyStoreRpcServer,
  type KeyStoreRpcServer,
  type KeyStoreRpcServerOptions,
} from "./server.ts";
export { createSocketTransport, type SocketTransportOptions } from "./socket.ts";
export {
  createKeyStoreWebSocketServer,
  type KeyStoreWebSocketServer,
  type KeyStoreWebSocketServerOptions,
  type WebSocketServerFactory,
} from "./websocket.ts";
export {
  DEFAULT_KEYSTORE_WS_PORT,
  defaultRpcSocketPath,
  isRpcMethod,
  RPC_METHODS,
  type RpcMethod,
} from "./protocol.ts";
