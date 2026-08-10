/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/keystore-remote` is the keystore **across a boundary**.
 *
 * The other keystore packages answer "where does the material live?" (the OS
 * keychain, IndexedDB, the platform secure enclave, an OWS vault). This one
 * answers a different question: *the keystore is somewhere else — how do I talk
 * to it?* It contains the JSON-RPC 2.0 protocol, the drop-in client engine that
 * implements the whole `KeyStore` contract by forwarding calls, and the
 * responder that answers them on the hosting side.
 *
 * It is deliberately **pure**: no Node built-ins, no DOM assumptions beyond the
 * standard `WebSocket`, so the same client runs in a web page, in a wallet, in
 * a worker or in another service. A {@link RemoteTransport} is the single seam
 * where a runtime enters — this package ships the
 * {@link createWebSocketTransport WebSocket} and
 * {@link createLoopbackTransport in-memory} ones, while
 * `@algorandfoundation/keystore-node` adds the local socket and the hosts that
 * accept connections.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import {
 *   createRemoteKeyStore,
 *   createWebSocketTransport,
 * } from "@algorandfoundation/keystore-remote";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createRemoteKeyStore({
 *   store,
 *   transport: createWebSocketTransport({ url: "ws://127.0.0.1:7413" }),
 * });
 * await keystore.ready;
 *
 * const [key] = store.state.keys;
 * const signature = await keystore.sign(key.id, new TextEncoder().encode("hi"));
 * await keystore.close();
 * ```
 */

export { createRemoteKeyStore } from "./client.ts";
export {
  WithRemoteKeyStore,
  withRemoteKeyStoreAt,
  type RemoteKeystoreOptions,
  type RemoteKeyStoreBlock,
} from "./extension.ts";
export { createLoopbackTransport } from "./loopback.ts";
export {
  createFrameDecoder,
  decodeFrame,
  decodeValue,
  encodeFrame,
  encodeValue,
  isRpcMethod,
  JSON_RPC_VERSION,
  RPC_METHODS,
  RPC_STATE_METHOD,
  RpcErrorCode,
  type FrameDecoder,
  type RpcError,
  type RpcMessage,
  type RpcMethod,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
} from "./protocol.ts";
export { createKeyStoreResponder } from "./server.ts";
export type {
  KeyStoreResponder,
  KeyStoreResponderOptions,
  RemoteChannel,
  RemoteChannelHandlers,
  RemoteKeyStore,
  RemoteKeyStoreOptions,
  RemoteSession,
  RemoteTransport,
} from "./types.ts";
export {
  createWebSocketTransport,
  type WebSocketConstructor,
  type WebSocketTransportOptions,
} from "./websocket.ts";
