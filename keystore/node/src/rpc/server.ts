/**
 * @module rpc/server
 *
 * The keystore RPC **service**: it hosts an already-built {@link KeyStore} over a
 * local stream socket (Unix domain socket / named pipe) and speaks the JSON-RPC
 * 2.0 protocol defined in {@link import("./protocol.ts")}.
 *
 * This is the second of the two Node engines: the in-process
 * {@link import("../engine.ts").createNodeKeyStore} is used directly inside a
 * Node application, while this service exposes the same keystore over IPC so
 * third-party processes can drive it through the drop-in
 * {@link import("./client.ts").createRpcKeyStore} client. The service is meant
 * to be run by the `keystore serve` CLI command, which owns the real OS-keychain
 * engine.
 *
 * Every request is dispatched to the hosted keystore against the method
 * allow-list ({@link RPC_METHODS}); the whole surface is exposed. On connect,
 * and on every reactive-store change thereafter, the current {@link KeyStoreState}
 * is pushed to the client as a `state` notification so remote clients stay
 * hydrated without polling.
 */

import { mkdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

import {
  createFrameDecoder,
  decodeValue,
  defaultRpcSocketPath,
  encodeFrame,
  encodeValue,
  isRpcMethod,
  JSON_RPC_VERSION,
  type RpcMessage,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
  RpcErrorCode,
  RPC_STATE_METHOD,
} from "./protocol.ts";

/** Options for {@link createKeyStoreRpcServer}. */
export interface KeyStoreRpcServerOptions {
  /**
   * The keystore to host. Typically the in-process
   * {@link import("../engine.ts").createNodeKeyStore} engine (OS keychain +
   * sealed metadata), but any {@link KeyStore} works.
   */
  keystore: KeyStore<void>;
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
 * Invokes a single allow-listed keystore method with already-decoded arguments.
 * The `secrets.*` names dispatch into the {@link KeyStore.secrets} namespace;
 * `state` is answered from the reactive store. Missing optional methods throw a
 * descriptive error that is surfaced to the client.
 */
async function invokeMethod(
  keystore: KeyStore<void>,
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
  socket: Socket,
  keystore: KeyStore<void>,
  store: Store<KeyStoreState>,
): Promise<void> {
  const write = (response: RpcResponse): void => {
    socket.write(encodeFrame(response));
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
  const { keystore, store } = options;
  const sockets = new Set<Socket>();

  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    const decoder = createFrameDecoder();

    // Push the current state on connect, then on every subsequent change, so a
    // client engine can keep its reactive store hydrated without polling.
    let unsubscribe: (() => void) | undefined;
    const sendState = (): void => {
      socket.write(
        encodeFrame({
          jsonrpc: JSON_RPC_VERSION,
          method: RPC_STATE_METHOD,
          params: [encodeValue(store.state)],
        }),
      );
    };
    keystore.ready
      .then(() => {
        sendState();
        // TanStack Store's `subscribe` returns a `Subscription`; normalize it to
        // a plain unsubscribe callback for cleanup on disconnect.
        const subscription = store.subscribe(sendState);
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch(() => {
        // A failed `ready` still surfaces per-request; nothing to push here.
      });

    socket.on("data", (chunk: Buffer) => {
      let messages: RpcMessage[];
      try {
        messages = decoder.push(chunk);
      } catch {
        // Ignore an unparseable frame rather than tear down the connection.
        return;
      }
      for (const message of messages) {
        if ("id" in message && typeof message.id === "number" && "method" in message) {
          void handleRequest(message as RpcRequest, socket, keystore, store);
        }
      }
    });

    const cleanup = (): void => {
      unsubscribe?.();
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
