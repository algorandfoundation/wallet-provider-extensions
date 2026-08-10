/**
 * @module types
 *
 * The transport seam of the remote keystore.
 *
 * A transport is the *only* runtime-specific part of a remote session: it moves
 * opaque {@link import("./protocol.ts").encodeFrame frames} between two peers
 * and reports when the link drops. Everything else — the protocol, the client
 * engine and the responder — is pure, so the same session works over a Unix
 * domain socket, a WebSocket, a `MessagePort`, a worker or a test loopback.
 */

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

/** One end of an open link: what a peer can do to it. */
export interface RemoteChannel {
  /**
   * Sends one frame. Implementations MAY buffer while the link is still being
   * established, so a caller never has to wait for an "open" event.
   *
   * @param frame - The frame produced by
   *   {@link import("./protocol.ts").encodeFrame}.
   */
  send(frame: string): void;
  /** Closes the link. Idempotent. */
  close(): void;
}

/** What a peer wants to be told about an open link. */
export interface RemoteChannelHandlers {
  /**
   * A frame arrived.
   *
   * @param frame - One complete frame; stream transports do their own framing.
   */
  message(frame: string): void;
  /**
   * The link ended.
   *
   * @param error - The failure that ended it, or `undefined` on a clean close.
   */
  close(error?: Error): void;
}

/**
 * Opens a link to a remote keystore.
 *
 * Called once by {@link import("./client.ts").createRemoteKeyStore}. The
 * returned {@link RemoteChannel} may already be connecting: frames sent before
 * the link is up are expected to be buffered by the transport.
 *
 * @param handlers - The callbacks the transport drives.
 * @returns The channel the client writes to.
 *
 * @example
 * ```typescript
 * const transport: RemoteTransport = (handlers) => {
 *   const socket = createConnection(path);
 *   socket.on("data", (chunk) => handlers.message(chunk.toString("utf8")));
 *   socket.on("close", () => handlers.close());
 *   return { send: (frame) => socket.write(frame), close: () => socket.destroy() };
 * };
 * ```
 */
export type RemoteTransport = (handlers: RemoteChannelHandlers) => RemoteChannel;

/** Options for {@link import("./client.ts").createRemoteKeyStore}. */
export interface RemoteKeyStoreOptions {
  /**
   * The reactive store to keep hydrated from the responder's `state` pushes.
   * Pass the same store you would hand any other engine so the provider's
   * reactive `keys`/`status`/`algorithms` reflect the remote keystore.
   */
  store: Store<KeyStoreState>;
  /** How to reach the remote keystore. */
  transport: RemoteTransport;
}

/**
 * The remote client engine: a {@link KeyStore} whose every operation is
 * forwarded to a remote keystore, plus a {@link RemoteKeyStore.close} to drop
 * the link.
 *
 * The per-operation context is carried too, so a context-taking keystore (the
 * OWS adapter's credential, a biometric prompt, …) can be driven remotely as
 * long as the context is JSON-serializable.
 */
export type RemoteKeyStore = KeyStore<unknown> & {
  /** Disconnects. Pending calls reject. */
  close(): Promise<void>;
};

/** A live server-side session: one connected client. */
export interface RemoteSession {
  /**
   * Feeds one received frame into the responder.
   *
   * @param frame - One complete frame.
   */
  receive(frame: string): void;
  /** Releases the session's subscriptions. Does not close the channel. */
  close(): void;
}

/** Options for {@link import("./server.ts").createKeyStoreResponder}. */
export interface KeyStoreResponderOptions {
  /**
   * The keystore to host. Any {@link KeyStore} works — the OS-keychain engine,
   * the OWS adapter, or even another remote client.
   */
  keystore: KeyStore<never>;
  /**
   * The reactive store backing `keystore`, subscribed to so state changes are
   * pushed to connected clients. This is the same `store` handed to the engine.
   */
  store: Store<KeyStoreState>;
}

/** A transport-neutral host for a keystore: turns channels into sessions. */
export interface KeyStoreResponder {
  /**
   * Serves one connected peer.
   *
   * @param channel - The peer's end of the link.
   * @returns The session to feed received frames into.
   */
  open(channel: RemoteChannel): RemoteSession;
}
