/**
 * @module loopback
 *
 * An in-memory {@link RemoteTransport} that wires a client engine straight to a
 * {@link KeyStoreResponder} in the same process.
 *
 * It carries no bytes and opens no port, but it exercises the *whole* remote
 * path — encoding, framing, dispatch, state pushes — which makes it the right
 * tool for testing a keystore's remote behaviour, and a convenient way to run a
 * daemon and its consumer inside one process (a worker, an Electron main
 * process, an integration test).
 */

import type {
  KeyStoreResponder,
  RemoteChannel,
  RemoteChannelHandlers,
  RemoteTransport,
} from "./types.ts";

/**
 * Creates a {@link RemoteTransport} served by `responder` in-process.
 *
 * Frames are delivered asynchronously (on a microtask) so neither side can
 * re-enter the other synchronously — the same ordering guarantee a real
 * transport gives.
 *
 * @param responder - The responder to serve the client.
 * @returns The transport to hand
 *   {@link import("./client.ts").createRemoteKeyStore}.
 *
 * @example
 * ```typescript
 * const responder = createKeyStoreResponder({ keystore, store: hostStore });
 * const client = createRemoteKeyStore({
 *   store: clientStore,
 *   transport: createLoopbackTransport(responder),
 * });
 * await client.ready;
 * ```
 */
export function createLoopbackTransport(responder: KeyStoreResponder): RemoteTransport {
  return (handlers: RemoteChannelHandlers): RemoteChannel => {
    let closed = false;

    const session = responder.open({
      send(frame: string): void {
        if (closed) return;
        queueMicrotask(() => {
          if (!closed) handlers.message(frame);
        });
      },
      close(): void {
        if (closed) return;
        closed = true;
        handlers.close();
      },
    });

    return {
      send(frame: string): void {
        if (closed) return;
        queueMicrotask(() => {
          if (!closed) session.receive(frame);
        });
      },
      close(): void {
        if (closed) return;
        closed = true;
        session.close();
      },
    };
  };
}
