/**
 * @module websocket
 *
 * The WebSocket {@link RemoteTransport}: the transport that takes the keystore
 * off the local machine.
 *
 * A Unix domain socket is gated by filesystem permissions and never leaves the
 * host; a WebSocket lets a remote consumer — a wallet UI, a web page, another
 * service — drive a keystore daemon over a network link. The protocol is
 * unchanged: one JSON-RPC frame per text message.
 *
 * Only the standard `WebSocket` global is used, so this module runs unchanged
 * in a browser, in Node (≥ 22, which ships a global `WebSocket`) and in any
 * other runtime that provides one; older runtimes can inject an implementation
 * through {@link WebSocketTransportOptions.WebSocket}.
 *
 * @remarks
 * The link is not encrypted or authenticated by this transport. Serve `wss://`
 * (or keep the daemon on a loopback interface) and put the credential in the
 * per-operation context of a context-taking keystore.
 */

import type { RemoteChannel, RemoteChannelHandlers, RemoteTransport } from "./types.ts";

/** The `WebSocket` constructor shape this transport needs. */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

/** Options for {@link createWebSocketTransport}. */
export interface WebSocketTransportOptions {
  /** The daemon's URL, e.g. `"ws://127.0.0.1:7413"` or `"wss://vault.internal"`. */
  url: string;
  /** Subprotocols to negotiate. */
  protocols?: string | string[];
  /**
   * The `WebSocket` implementation to use. Defaults to `globalThis.WebSocket`;
   * pass one explicitly on a runtime that has none (or to inject a fake).
   */
  WebSocket?: WebSocketConstructor;
}

/** Resolves the `WebSocket` implementation, failing loudly when there is none. */
function resolveWebSocket(options: WebSocketTransportOptions): WebSocketConstructor {
  const implementation =
    options.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!implementation) {
    throw new Error(
      "no WebSocket implementation available; pass `WebSocket` in the transport options",
    );
  }
  return implementation;
}

/**
 * Creates a {@link RemoteTransport} that reaches a keystore daemon over a
 * WebSocket.
 *
 * The socket is opened as soon as the transport is used; frames sent while it
 * is still connecting are buffered and flushed on `open`, so a caller never has
 * to wait for a connection event. A close or error ends the session, which
 * rejects the client's `ready` (or any in-flight call) with the reason.
 *
 * @param options - {@link WebSocketTransportOptions}.
 * @returns The transport to hand
 *   {@link import("./client.ts").createRemoteKeyStore}.
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
 * ```
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): RemoteTransport {
  const Implementation = resolveWebSocket(options);

  return (handlers: RemoteChannelHandlers): RemoteChannel => {
    const socket = new Implementation(options.url, options.protocols);
    const backlog: string[] = [];
    let open = false;
    let ended = false;

    /** Reports the end of the link exactly once. */
    const end = (error?: Error): void => {
      if (ended) return;
      ended = true;
      handlers.close(error);
    };

    socket.addEventListener("open", () => {
      open = true;
      for (const frame of backlog) socket.send(frame);
      backlog.length = 0;
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      const { data } = event;
      if (typeof data === "string") {
        handlers.message(data);
      } else if (data instanceof ArrayBuffer) {
        handlers.message(new TextDecoder().decode(data));
      } else if (typeof (data as Blob)?.text === "function") {
        void (data as Blob).text().then((frame) => handlers.message(frame));
      }
    });

    socket.addEventListener("error", () => {
      // The DOM error event carries no detail; `close` follows with the reason.
      end(new Error(`keystore WebSocket connection to ${options.url} failed`));
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      end(
        event.wasClean || event.code === 1000
          ? undefined
          : new Error(
              `keystore WebSocket connection closed (${event.code}${
                event.reason ? `: ${event.reason}` : ""
              })`,
            ),
      );
    });

    return {
      send(frame: string): void {
        if (open) {
          socket.send(frame);
        } else {
          backlog.push(frame);
        }
      },
      close(): void {
        backlog.length = 0;
        socket.close();
      },
    };
  };
}
