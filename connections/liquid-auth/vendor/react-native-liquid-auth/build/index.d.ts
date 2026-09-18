import type { IceServer, LiquidAuthConnectionState, LiquidAuthConnectionStateEvent, LiquidAuthConnectOptions, LiquidAuthLinkErrorEvent, LiquidAuthMessage, LiquidAuthMessageEvent, LiquidAuthPeerType, LiquidAuthPresenceEvent, LiquidAuthResponse, LiquidAuthSignalingStateEvent, LiquidAuthStateChangeEvent, LiquidAuthTrackEvent } from './LiquidAuthNative.types';
import LiquidAuthNativeModule from './LiquidAuthNativeModule';
export * from './LiquidAuthNative.types';
export * from './nativeChannel';
/** Subscription returned by the event listener helpers. */
export type EventSubscription = ReturnType<typeof LiquidAuthNativeModule.addListener>;
export { default } from './LiquidAuthNativeModule';
/**
 * Generate a random (time-based) request id.
 */
export declare function generateRequestId(): string;
/**
 * Parse a `liquid://<origin>/?requestId=<id>` URI (or JSON payload).
 */
export declare function parseMessage(value: string): LiquidAuthMessage;
/**
 * Start (and bind to) the background signaling service and connect the
 * signaling client to the given `origin`.
 */
export declare function start(url: string): Promise<void>;
/**
 * Connect to a remote peer by `requestId`.
 *
 * Pass `options.dataChannels` to open multiple named data channels (e.g.
 * `ac2-v1`, `ac2-stream`) when acting as the offerer (`type: 'answer'`).
 * Pass `options.notifications` to customize (or suppress) the ongoing
 * notification, which reflects the connected / idle ("tap to open") /
 * new-messages states.
 * Pass `options.queueChannels` to choose which channels the service buffers
 * while the app is offline (replayed via `onMessage` once online; see
 * {@link setActive}).
 * Pass `options.heartbeat` to have the background service answer the peer's
 * keepalive `ping` with a `pong` natively while the app is offline, so the
 * connection survives being backgrounded.
 */
export declare function connect(requestId: string, type: LiquidAuthPeerType, iceServers?: IceServer[], options?: LiquidAuthConnectOptions): Promise<void>;
/**
 * Snapshot the background service's CURRENT connection so a re-attaching app
 * can hydrate its UI (instead of assuming a fresh start) when it reconnects to
 * a still-running service. Safe to call before {@link start} (returns
 * `connected: false`).
 */
export declare function getConnectionState(): LiquidAuthConnectionState;
/**
 * Re-attach to the ALREADY-live connection without renegotiating: rebind the
 * event listeners to this (fresh) JS runtime and re-emit the current channel +
 * ICE state so the app hydrates. Use when {@link getConnectionState} reports
 * `connected: true` (e.g. after a relaunch that reconnected to the
 * still-running background service). `options` carries the same
 * `notifications`/`queueChannels`/`heartbeat` config as {@link connect}.
 */
export declare function attach(options?: LiquidAuthConnectOptions): Promise<void>;
/**
 * Abort an in-flight {@link connect} negotiation. The pending `connect`
 * promise rejects with an `E_ABORTED` error.
 */
export declare function cancel(): Promise<void>;
/**
 * Set whether the app is currently online (foregrounded, with its JS listeners
 * attached). Drive this from the app's foreground/background lifecycle so the
 * app — not the library — controls the signaling delivery state. Deliberately
 * does NOT replay the offline queue (a relaunching app flips active before its
 * listeners are rewired); replay happens when a fresh sink attaches
 * ({@link connect} / {@link attach}) or via an explicit {@link flushQueue}.
 */
export declare function setActive(active: boolean): void;
/**
 * Explicitly replay any messages the background service buffered while the app
 * was offline, through the `onMessage` event in arrival order. Call it only
 * once the JS message listeners are wired (e.g. right after a foreground
 * transition with a live transport, or after a negotiation completes), so the
 * replay can't race the listener setup. No-op when nothing is buffered.
 */
export declare function flushQueue(): void;
/**
 * Send a message over the primary (`liquid`) data channel.
 */
export declare function send(message: string): void;
/**
 * Send a message over a specific named data channel.
 */
export declare function sendToChannel(channel: string, message: string): void;
/**
 * Stop the signaling client and unbind/stop the background service.
 */
export declare function disconnect(): Promise<void>;
/**
 * Perform an authenticated HTTP request through the native module's shared
 * cookie-jar client (the same client that backs the background signaling
 * socket). Session cookies set by the response (e.g. `connect.sid`) are
 * captured natively, so a subsequent {@link start} authenticates
 * transparently. Use this to run the whole Liquid Auth HTTP exchange
 * (attestation/assertion options + response, `/auth/session`) natively so the
 * background service shares the wallet's session.
 */
export declare function request(url: string, method?: string, headers?: Record<string, string>, body?: string): Promise<LiquidAuthResponse>;
/**
 * Subscribe to data-channel messages received from the peer.
 */
export declare function addMessageListener(listener: (event: LiquidAuthMessageEvent) => void): EventSubscription;
/**
 * Subscribe to data-channel state changes (`OPEN`, `CLOSING`, `CLOSED`, ...).
 */
export declare function addStateChangeListener(listener: (event: LiquidAuthStateChangeEvent) => void): EventSubscription;
/**
 * Subscribe to remote media tracks added to the peer connection.
 */
export declare function addTrackListener(listener: (event: LiquidAuthTrackEvent) => void): EventSubscription;
/**
 * Subscribe to server-broadcast `presence` updates for the connected
 * `requestId` (how many devices are connected).
 */
export declare function addPresenceListener(listener: (event: LiquidAuthPresenceEvent) => void): EventSubscription;
/**
 * Subscribe to signaling link errors (e.g. the two-peer lockdown `link-error`
 * room refusal), so a full session can fail fast instead of timing out.
 */
export declare function addLinkErrorListener(listener: (event: LiquidAuthLinkErrorEvent) => void): EventSubscription;
/**
 * Subscribe to peer ICE connection-state changes (`CONNECTED`, `DISCONNECTED`,
 * `FAILED`, ...), for connectivity monitoring after negotiation.
 */
export declare function addConnectionStateListener(listener: (event: LiquidAuthConnectionStateEvent) => void): EventSubscription;
/**
 * Subscribe to signaling-socket connectivity changes (`connected` /
 * `disconnected`), including socket.io auto-reconnects. Independent of the
 * p2p connection — the data channels deliberately survive signaling
 * disruptions — so the app can surface a dedicated "signaling server offline"
 * state. Seed the initial value from {@link getConnectionState}'s
 * `signalingConnected` when subscribing after {@link start}.
 */
export declare function addSignalingStateListener(listener: (event: LiquidAuthSignalingStateEvent) => void): EventSubscription;
//# sourceMappingURL=index.d.ts.map