/**
 * @module rpc/socket
 *
 * The local-socket {@link RemoteTransport}: a Unix domain socket, or a named
 * pipe on Windows.
 *
 * This is the most private way to reach a keystore daemon — no TCP port is
 * opened and access is gated by filesystem permissions on the socket — and it
 * is the transport the `keystore serve` CLI uses by default. Being a *stream*,
 * it does its own NDJSON framing before handing whole frames to the
 * transport-neutral client.
 */

import { createConnection, type Socket } from "node:net";

import {
  createFrameDecoder,
  encodeFrame,
  type RemoteChannel,
  type RemoteChannelHandlers,
  type RemoteTransport,
} from "@algorandfoundation/keystore-remote";

import { defaultRpcSocketPath } from "./protocol.ts";

/** Options for {@link createSocketTransport}. */
export interface SocketTransportOptions {
  /**
   * The socket path / named pipe of the running service. Defaults to
   * {@link defaultRpcSocketPath} (must match the server's).
   */
  path?: string;
}

/**
 * Creates a {@link RemoteTransport} that reaches a keystore service over a
 * local stream socket.
 *
 * @param options - {@link SocketTransportOptions}.
 * @returns The transport to hand
 *   {@link import("@algorandfoundation/keystore-remote").createRemoteKeyStore}.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createRemoteKeyStore } from "@algorandfoundation/keystore-remote";
 * import { createSocketTransport } from "@algorandfoundation/keystore-node/rpc";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createRemoteKeyStore({ store, transport: createSocketTransport({}) });
 * ```
 */
export function createSocketTransport(options: SocketTransportOptions = {}): RemoteTransport {
  const socketPath = options.path ?? defaultRpcSocketPath();

  return (handlers: RemoteChannelHandlers): RemoteChannel => {
    const socket: Socket = createConnection(socketPath);
    socket.setNoDelay(true);
    const decoder = createFrameDecoder();
    let ended = false;

    /** Reports the end of the link exactly once. */
    const end = (error?: Error): void => {
      if (ended) return;
      ended = true;
      handlers.close(error);
    };

    socket.on("data", (chunk: Buffer) => {
      let messages;
      try {
        messages = decoder.push(chunk.toString("utf8"));
      } catch {
        // Ignore an unparseable frame rather than tear down the connection.
        return;
      }
      // The client re-parses whole frames, so hand each message back framed.
      for (const message of messages) handlers.message(encodeFrame(message));
    });

    socket.on("error", (error: Error) => end(error));
    socket.on("close", () => end());

    return {
      send(frame: string): void {
        socket.write(frame);
      },
      close(): void {
        socket.destroy();
      },
    };
  };
}
