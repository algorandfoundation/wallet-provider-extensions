/**
 * @module rpc/websocket
 *
 * The keystore RPC **service over a WebSocket**: the same responder as the
 * local-socket {@link import("./server.ts").createKeyStoreRpcServer service},
 * reachable from off the machine.
 *
 * A Unix domain socket is the safest default — no port, filesystem permissions
 * as the gate — but it stops at the host. Spinning the daemon up behind a
 * WebSocket lets a remote consumer (a wallet, a web page, another service)
 * drive the very same keystore with the very same client engine: only the
 * transport differs.
 *
 * The listener is built on [`ws`](https://www.npmjs.com/package/ws), an
 * **optional** dependency loaded lazily — exactly like `@napi-rs/keyring` — so
 * the package stays installable for anyone who only wants the local socket.
 *
 * @remarks
 * The service binds `127.0.0.1` by default and adds no authentication of its
 * own: anything that can open the socket can drive the keystore. Before
 * exposing it beyond loopback, terminate TLS in front of it (`wss://`) and host
 * a keystore that authenticates every call through its per-operation context —
 * the OWS adapter, whose context carries the OWS credential, is built for
 * exactly this.
 */

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import { createKeyStoreResponder } from "@algorandfoundation/keystore-remote";
import type { Store } from "@tanstack/store";

import { DEFAULT_KEYSTORE_WS_PORT } from "./protocol.ts";

/** The subset of a `ws` socket the service drives. */
interface WsSocketLike {
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** The subset of a `ws` server the service drives. */
interface WsServerLike {
  on(event: "connection", listener: (socket: WsSocketLike) => void): unknown;
  on(event: "listening", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  address(): { port: number } | string | null;
  close(callback?: (error?: Error) => void): unknown;
}

/**
 * Constructs the underlying WebSocket listener.
 *
 * Injectable so a test — or a runtime with its own WebSocket server — can
 * replace `ws` without touching the service.
 */
export type WebSocketServerFactory = (options: {
  /** Interface to bind. */
  host: string;
  /** TCP port to bind (`0` picks a free one). */
  port: number;
  /** URL path clients must connect to. */
  path: string;
}) => WsServerLike;

/** Options for {@link createKeyStoreWebSocketServer}. */
export interface KeyStoreWebSocketServerOptions {
  /**
   * The keystore to host. Any {@link KeyStore} works: the OS-keychain engine,
   * the OWS adapter, or an already-remote client being re-published.
   */
  keystore: KeyStore<never>;
  /**
   * The reactive store backing `keystore`, subscribed to so state changes are
   * pushed to connected clients.
   */
  store: Store<KeyStoreState>;
  /** TCP port to bind. Defaults to {@link DEFAULT_KEYSTORE_WS_PORT}; `0` picks a free one. */
  port?: number;
  /** Interface to bind. Defaults to `"127.0.0.1"` — loopback only. */
  host?: string;
  /** URL path clients must connect to. Defaults to `"/"`. */
  path?: string;
  /** The listener implementation. Defaults to the lazily-imported `ws` server. */
  server?: WebSocketServerFactory;
}

/** A running (or listenable) keystore WebSocket service. */
export interface KeyStoreWebSocketServer {
  /** The URL clients connect to. Only meaningful once `listen` has resolved. */
  readonly url: string;
  /**
   * Starts listening.
   *
   * @returns The bound URL (with the real port, when `0` was requested).
   */
  listen(): Promise<string>;
  /** Stops the service and drops all connections. */
  close(): Promise<void>;
}

/** Loads the optional `ws` package, explaining how to fix a missing install. */
async function loadWebSocketServer(): Promise<WebSocketServerFactory> {
  let module: { WebSocketServer: new (options: object) => WsServerLike };
  try {
    module = (await import("ws")) as unknown as {
      WebSocketServer: new (options: object) => WsServerLike;
    };
  } catch (error) {
    throw new Error(
      "the WebSocket keystore service needs the optional `ws` package; install it with `npm install ws`",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  return (options) => new module.WebSocketServer(options);
}

/**
 * Creates a keystore RPC service that hosts `options.keystore` over a
 * WebSocket. The service is not listening until
 * {@link KeyStoreWebSocketServer.listen} is awaited.
 *
 * Consumers reach it with the ordinary remote engine and the WebSocket
 * transport, from Node or from a browser — the daemon does not care which.
 *
 * @param options - {@link KeyStoreWebSocketServerOptions}.
 * @returns A {@link KeyStoreWebSocketServer} handle.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createNodeKeyStore, createKeyStoreWebSocketServer } from "@algorandfoundation/keystore-node";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createNodeKeyStore({ store });
 * const server = createKeyStoreWebSocketServer({ keystore, store, port: 7413 });
 * console.log(`keystore listening on ${await server.listen()}`);
 * ```
 */
export function createKeyStoreWebSocketServer(
  options: KeyStoreWebSocketServerOptions,
): KeyStoreWebSocketServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_KEYSTORE_WS_PORT;
  const path = options.path ?? "/";
  const responder = createKeyStoreResponder({
    keystore: options.keystore,
    store: options.store,
  });

  const toUrl = (boundPort: number): string =>
    `ws://${host.includes(":") ? `[${host}]` : host}:${boundPort}${path === "/" ? "" : path}`;

  let server: WsServerLike | undefined;
  let url = toUrl(port);
  const sockets = new Set<WsSocketLike>();

  return {
    get url(): string {
      return url;
    },

    async listen(): Promise<string> {
      const factory = options.server ?? (await loadWebSocketServer());
      const listener = factory({ host, port, path });
      server = listener;

      listener.on("connection", (socket: WsSocketLike) => {
        sockets.add(socket);
        const session = responder.open({
          send: (frame: string) => socket.send(frame),
          close: () => socket.close(),
        });
        const cleanup = (): void => {
          session.close();
          sockets.delete(socket);
        };
        // `ws` hands over a Buffer for a text frame; the protocol is UTF-8 text.
        socket.on("message", (data: unknown) => session.receive(String(data)));
        socket.on("close", cleanup);
        socket.on("error", cleanup);
      });

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        listener.on("error", onError);
        listener.on("listening", () => resolve());
      });

      const address = listener.address();
      url = toUrl(typeof address === "object" && address !== null ? address.port : port);
      return url;
    },

    async close(): Promise<void> {
      const listener = server;
      if (!listener) return;
      server = undefined;
      // `ws` only resolves `close` once every client has gone, so drop them.
      for (const socket of sockets) socket.close();
      sockets.clear();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}
