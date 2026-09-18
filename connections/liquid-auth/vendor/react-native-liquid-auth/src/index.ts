import type {
  IceServer,
  LiquidAuthConnectionState,
  LiquidAuthConnectionStateEvent,
  LiquidAuthConnectOptions,
  LiquidAuthLinkErrorEvent,
  LiquidAuthMessage,
  LiquidAuthMessageEvent,
  LiquidAuthPeerType,
  LiquidAuthPresenceEvent,
  LiquidAuthResponse,
  LiquidAuthSignalingStateEvent,
  LiquidAuthStateChangeEvent,
  LiquidAuthTrackEvent,
} from './LiquidAuthNative.types';
import LiquidAuthNativeModule from './LiquidAuthNativeModule';

export * from './LiquidAuthNative.types';

// RTCDataChannel/RTCPeerConnection-shaped adapters over the native event API,
// so consumers written against `react-native-webrtc` can drive the native
// background service unchanged. See `./nativeChannel`.
export * from './nativeChannel';

/** Subscription returned by the event listener helpers. */
export type EventSubscription = ReturnType<typeof LiquidAuthNativeModule.addListener>;

// Re-export the native module. On web it resolves to LiquidAuthNativeModule.web.ts
// and on native platforms to LiquidAuthNativeModule.ts
export { default } from './LiquidAuthNativeModule';

/**
 * Generate a random (time-based) request id.
 */
export function generateRequestId(): string {
  return LiquidAuthNativeModule.generateRequestId();
}

/**
 * Parse a `liquid://<origin>/?requestId=<id>` URI (or JSON payload).
 */
export function parseMessage(value: string): LiquidAuthMessage {
  return LiquidAuthNativeModule.parseMessage(value);
}

/**
 * Start (and bind to) the background signaling service and connect the
 * signaling client to the given `origin`.
 */
export function start(url: string): Promise<void> {
  return LiquidAuthNativeModule.start(url);
}

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
export function connect(
  requestId: string,
  type: LiquidAuthPeerType,
  iceServers?: IceServer[],
  options?: LiquidAuthConnectOptions,
): Promise<void> {
  return LiquidAuthNativeModule.connect(requestId, type, iceServers, options);
}

/**
 * Snapshot the background service's CURRENT connection so a re-attaching app
 * can hydrate its UI (instead of assuming a fresh start) when it reconnects to
 * a still-running service. Safe to call before {@link start} (returns
 * `connected: false`).
 */
export function getConnectionState(): LiquidAuthConnectionState {
  return LiquidAuthNativeModule.getConnectionState();
}

/**
 * Re-attach to the ALREADY-live connection without renegotiating: rebind the
 * event listeners to this (fresh) JS runtime and re-emit the current channel +
 * ICE state so the app hydrates. Use when {@link getConnectionState} reports
 * `connected: true` (e.g. after a relaunch that reconnected to the
 * still-running background service). `options` carries the same
 * `notifications`/`queueChannels`/`heartbeat` config as {@link connect}.
 */
export function attach(options?: LiquidAuthConnectOptions): Promise<void> {
  return LiquidAuthNativeModule.attach(options);
}

/**
 * Abort an in-flight {@link connect} negotiation. The pending `connect`
 * promise rejects with an `E_ABORTED` error.
 */
export function cancel(): Promise<void> {
  return LiquidAuthNativeModule.cancel();
}

/**
 * Set whether the app is currently online (foregrounded, with its JS listeners
 * attached). Drive this from the app's foreground/background lifecycle so the
 * app — not the library — controls the signaling delivery state. Deliberately
 * does NOT replay the offline queue (a relaunching app flips active before its
 * listeners are rewired); replay happens when a fresh sink attaches
 * ({@link connect} / {@link attach}) or via an explicit {@link flushQueue}.
 */
export function setActive(active: boolean): void {
  // Parity gap: the iOS module doesn't implement the delivery gate yet
  // (Android-only). A missing method must be a no-op, not a TypeError — this
  // is called from AppState listeners, where an uncaught throw is fatal.
  if (typeof LiquidAuthNativeModule.setActive !== 'function') return;
  return LiquidAuthNativeModule.setActive(active);
}

/**
 * Explicitly replay any messages the background service buffered while the app
 * was offline, through the `onMessage` event in arrival order. Call it only
 * once the JS message listeners are wired (e.g. right after a foreground
 * transition with a live transport, or after a negotiation completes), so the
 * replay can't race the listener setup. No-op when nothing is buffered.
 */
export function flushQueue(): void {
  // Parity gap: not implemented on iOS yet (see setActive) — the iOS service
  // doesn't buffer offline messages, so there is nothing to replay.
  if (typeof LiquidAuthNativeModule.flushQueue !== 'function') return;
  return LiquidAuthNativeModule.flushQueue();
}

/**
 * Send a message over the primary (`liquid`) data channel.
 */
export function send(message: string): void {
  return LiquidAuthNativeModule.send(message);
}

/**
 * Send a message over a specific named data channel.
 */
export function sendToChannel(channel: string, message: string): void {
  return LiquidAuthNativeModule.sendToChannel(channel, message);
}

/**
 * Stop the signaling client and unbind/stop the background service.
 */
export function disconnect(): Promise<void> {
  return LiquidAuthNativeModule.disconnect();
}

/**
 * Perform an authenticated HTTP request through the native module's shared
 * cookie-jar client (the same client that backs the background signaling
 * socket). Session cookies set by the response (e.g. `connect.sid`) are
 * captured natively, so a subsequent {@link start} authenticates
 * transparently. Use this to run the whole Liquid Auth HTTP exchange
 * (attestation/assertion options + response, `/auth/session`) natively so the
 * background service shares the wallet's session.
 */
export async function request(
  url: string,
  method: string = 'GET',
  headers?: Record<string, string>,
  body?: string,
): Promise<LiquidAuthResponse> {
  if (typeof LiquidAuthNativeModule.request === 'function') {
    return LiquidAuthNativeModule.request(url, method, headers, body);
  }
  // Parity gap: the iOS module has no native cookie-jar client yet
  // (Android-only). Fall back to RN's fetch — on iOS both RN networking and
  // the module's signaling socket use the process-wide NSHTTPCookieStorage,
  // so the `connect.sid` session cookie still reaches the native socket and
  // the Liquid Auth exchange stays authenticated.
  const res = await fetch(url, {
    method,
    ...(headers ? { headers } : {}),
    ...(body != null ? { body } : {}),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, body: text };
}

/**
 * Subscribe to data-channel messages received from the peer.
 */
export function addMessageListener(
  listener: (event: LiquidAuthMessageEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onMessage', listener);
}

/**
 * Subscribe to data-channel state changes (`OPEN`, `CLOSING`, `CLOSED`, ...).
 */
export function addStateChangeListener(
  listener: (event: LiquidAuthStateChangeEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onStateChange', listener);
}

/**
 * Subscribe to remote media tracks added to the peer connection.
 */
export function addTrackListener(
  listener: (event: LiquidAuthTrackEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onTrack', listener);
}

/**
 * Subscribe to server-broadcast `presence` updates for the connected
 * `requestId` (how many devices are connected).
 */
export function addPresenceListener(
  listener: (event: LiquidAuthPresenceEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onPresence', listener);
}

/**
 * Subscribe to signaling link errors (e.g. the two-peer lockdown `link-error`
 * room refusal), so a full session can fail fast instead of timing out.
 */
export function addLinkErrorListener(
  listener: (event: LiquidAuthLinkErrorEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onLinkError', listener);
}

/**
 * Subscribe to peer ICE connection-state changes (`CONNECTED`, `DISCONNECTED`,
 * `FAILED`, ...), for connectivity monitoring after negotiation.
 */
export function addConnectionStateListener(
  listener: (event: LiquidAuthConnectionStateEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onConnectionStateChange', listener);
}

/**
 * Subscribe to signaling-socket connectivity changes (`connected` /
 * `disconnected`), including socket.io auto-reconnects. Independent of the
 * p2p connection — the data channels deliberately survive signaling
 * disruptions — so the app can surface a dedicated "signaling server offline"
 * state. Seed the initial value from {@link getConnectionState}'s
 * `signalingConnected` when subscribing after {@link start}.
 */
export function addSignalingStateListener(
  listener: (event: LiquidAuthSignalingStateEvent) => void,
): EventSubscription {
  return LiquidAuthNativeModule.addListener('onSignalingStateChange', listener);
}
