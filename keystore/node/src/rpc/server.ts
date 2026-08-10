/**
 * @module rpc/server
 *
 * The keystore RPC **service** over a local stream socket (a Unix domain
 * socket, or a named pipe on Windows).
 *
 * The hosting logic itself — dispatch, encoding, state pushes — is the
 * transport-neutral {@link createKeyStoreResponder} of
 * `@algorandfoundation/keystore-remote`; this module only accepts connections
 * and adapts each socket to a channel. The
 * {@link import("./websocket.ts").createKeyStoreWebSocketServer WebSocket
 * service} is the same responder behind a different door.
 *
 * This is the second of the two Node engines: the in-process
 * {@link import("../engine.ts").createNodeKeyStore} is used directly inside a
 * Node application, while this service exposes the same keystore over IPC so
 * third-party processes can drive it through the drop-in
 * {@link import("./client.ts").createRpcKeyStore} client. The service is meant
 * to be run by the `keystore serve` CLI command, which owns the real
 * OS-keychain engine.
 */

import { mkdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import {
  createFrameDecoder,
  createKeyStoreResponder,
  encodeFrame,
} from "@algorandfoundation/keystore-remote";
import type { Store } from "@tanstack/store";

import { defaultRpcSocketPath } from "./protocol.ts";

/** Options for {@link createKeyStoreRpcServer}. */
export interface KeyStoreRpcServerOptions {
  /**
   * The keystore to host. Typically the in-process
   * {@link import("../engine.ts").createNodeKeyStore} engine (OS keychain +
   * sealed metadata), but any {@link KeyStore} works — including the OWS
   * adapter, which makes the daemon a front end to an OWS vault.
   */
  keystore: KeyStore<never>;
  /**
   * The reactive store backing `keystore`, subscribed to so state changes are
   * pushed to connected clients. This is the same `store` handed to the engine.
   */
  store: Store<KeyStoreState>;
  /**
   * The socket path (Unix domain socket) or named pipe (Windows) to listen on.
   * Defaults to {@link defaultRpcSocketPath}.
   */
  path?: string;
}

/** A running (or listenable) keystore RPC service. */
export interface KeyStoreRpcServer {
  /** The socket path / named pipe the service listens on. */
  readonly path: string;
  /**
   * Starts listening. On POSIX it first ensures the parent directory exists and
   * removes any stale socket file.
   *
   * @returns The bound socket path.
   */
  listen(): Promise<string>;
  /** Stops the service and drops all connections. */
  close(): Promise<void>;
}

/**
 * Creates a keystore RPC service that hosts `options.keystore` over a local
 * socket. The service is not listening until {@link KeyStoreRpcServer.listen} is
 * awaited.
 *
 * @param options - {@link KeyStoreRpcServerOptions}.
 * @returns A {@link KeyStoreRpcServer} handle.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createNodeKeyStore, createKeyStoreRpcServer } from "@algorandfoundation/keystore-node";
 *
 * const store = new Store({ keys: [], status: "idle", algorithms: [] });
 * const keystore = createNodeKeyStore({ store });
 * const server = createKeyStoreRpcServer({ keystore, store });
 * const path = await server.listen();
 * console.log(`keystore RPC listening on ${path}`);
 * ```
 */
export function createKeyStoreRpcServer(options: KeyStoreRpcServerOptions): KeyStoreRpcServer {
  const socketPath = options.path ?? defaultRpcSocketPath();
  const responder = createKeyStoreResponder({
    keystore: options.keystore,
    store: options.store,
  });
  const sockets = new Set<Socket>();

  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    const decoder = createFrameDecoder();
    const session = responder.open({
      send: (frame: string) => {
        socket.write(frame);
      },
      close: () => socket.end(),
    });

    socket.on("data", (chunk: Buffer) => {
      let messages;
      try {
        messages = decoder.push(chunk.toString("utf8"));
      } catch {
        // Ignore an unparseable frame rather than tear down the connection.
        return;
      }
      for (const message of messages) session.receive(encodeFrame(message));
    });

    const cleanup = (): void => {
      session.close();
      sockets.delete(socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  return {
    path: socketPath,
    async listen(): Promise<string> {
      // POSIX stream sockets are filesystem entries; prepare the directory and
      // clear any stale socket left by a previous crash. Named pipes on Windows
      // need neither step.
      if (process.platform !== "win32") {
        await mkdir(dirname(socketPath), { recursive: true });
        await rm(socketPath, { force: true });
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        server.once("error", onError);
        server.listen(socketPath, () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      return socketPath;
    },
    async close(): Promise<void> {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== "win32") {
        await rm(socketPath, { force: true });
      }
    },
  };
}
