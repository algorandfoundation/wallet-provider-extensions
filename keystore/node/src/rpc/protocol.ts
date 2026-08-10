/**
 * @module rpc/protocol
 *
 * The wire protocol of the Node keystore RPC surface.
 *
 * It lives in the pure, transport-neutral
 * [`@algorandfoundation/keystore-remote`](../../../remote/README.md) package —
 * a browser or a wallet must be able to speak it without depending on anything
 * Node-specific — and is re-exported here so existing importers of
 * `keystore-node/rpc` keep working unchanged.
 *
 * The only genuinely Node-specific part of the protocol is where the local
 * transport lives on disk: {@link defaultRpcSocketPath}.
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
} from "@algorandfoundation/keystore-remote";

/**
 * The default socket path the service listens on and clients connect to when no
 * explicit `path` is given: a Unix domain socket under the keystore's home
 * directory, or a named pipe on Windows.
 *
 * @returns The platform-appropriate default socket path.
 */
export function defaultRpcSocketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\algorand-keystore";
  }
  return join(homedir(), ".algorand-keystore", "keystore.sock");
}

/**
 * The default TCP port the WebSocket service listens on when no explicit `port`
 * is given.
 *
 * @remarks
 * Unlike the local socket, a WebSocket listener is reachable over the network,
 * so the service binds the loopback interface by default.
 */
export const DEFAULT_KEYSTORE_WS_PORT = 7413;
