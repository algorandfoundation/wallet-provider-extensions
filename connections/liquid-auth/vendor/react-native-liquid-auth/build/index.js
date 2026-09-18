import LiquidAuthNativeModule from './LiquidAuthNativeModule';
export * from './LiquidAuthNative.types';
// RTCDataChannel/RTCPeerConnection-shaped adapters over the native event API,
// so consumers written against `react-native-webrtc` can drive the native
// background service unchanged. See `./nativeChannel`.
export * from './nativeChannel';
// Re-export the native module. On web it resolves to LiquidAuthNativeModule.web.ts
// and on native platforms to LiquidAuthNativeModule.ts
export { default } from './LiquidAuthNativeModule';
/**
 * Generate a random (time-based) request id.
 */
export function generateRequestId() {
    return LiquidAuthNativeModule.generateRequestId();
}
/**
 * Parse a `liquid://<origin>/?requestId=<id>` URI (or JSON payload).
 */
export function parseMessage(value) {
    return LiquidAuthNativeModule.parseMessage(value);
}
/**
 * Start (and bind to) the background signaling service and connect the
 * signaling client to the given `origin`.
 */
export function start(url) {
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
export function connect(requestId, type, iceServers, options) {
    return LiquidAuthNativeModule.connect(requestId, type, iceServers, options);
}
/**
 * Snapshot the background service's CURRENT connection so a re-attaching app
 * can hydrate its UI (instead of assuming a fresh start) when it reconnects to
 * a still-running service. Safe to call before {@link start} (returns
 * `connected: false`).
 */
export function getConnectionState() {
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
export function attach(options) {
    return LiquidAuthNativeModule.attach(options);
}
/**
 * Abort an in-flight {@link connect} negotiation. The pending `connect`
 * promise rejects with an `E_ABORTED` error.
 */
export function cancel() {
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
export function setActive(active) {
    return LiquidAuthNativeModule.setActive(active);
}
/**
 * Explicitly replay any messages the background service buffered while the app
 * was offline, through the `onMessage` event in arrival order. Call it only
 * once the JS message listeners are wired (e.g. right after a foreground
 * transition with a live transport, or after a negotiation completes), so the
 * replay can't race the listener setup. No-op when nothing is buffered.
 */
export function flushQueue() {
    return LiquidAuthNativeModule.flushQueue();
}
/**
 * Send a message over the primary (`liquid`) data channel.
 */
export function send(message) {
    return LiquidAuthNativeModule.send(message);
}
/**
 * Send a message over a specific named data channel.
 */
export function sendToChannel(channel, message) {
    return LiquidAuthNativeModule.sendToChannel(channel, message);
}
/**
 * Stop the signaling client and unbind/stop the background service.
 */
export function disconnect() {
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
export function request(url, method = 'GET', headers, body) {
    return LiquidAuthNativeModule.request(url, method, headers, body);
}
/**
 * Subscribe to data-channel messages received from the peer.
 */
export function addMessageListener(listener) {
    return LiquidAuthNativeModule.addListener('onMessage', listener);
}
/**
 * Subscribe to data-channel state changes (`OPEN`, `CLOSING`, `CLOSED`, ...).
 */
export function addStateChangeListener(listener) {
    return LiquidAuthNativeModule.addListener('onStateChange', listener);
}
/**
 * Subscribe to remote media tracks added to the peer connection.
 */
export function addTrackListener(listener) {
    return LiquidAuthNativeModule.addListener('onTrack', listener);
}
/**
 * Subscribe to server-broadcast `presence` updates for the connected
 * `requestId` (how many devices are connected).
 */
export function addPresenceListener(listener) {
    return LiquidAuthNativeModule.addListener('onPresence', listener);
}
/**
 * Subscribe to signaling link errors (e.g. the two-peer lockdown `link-error`
 * room refusal), so a full session can fail fast instead of timing out.
 */
export function addLinkErrorListener(listener) {
    return LiquidAuthNativeModule.addListener('onLinkError', listener);
}
/**
 * Subscribe to peer ICE connection-state changes (`CONNECTED`, `DISCONNECTED`,
 * `FAILED`, ...), for connectivity monitoring after negotiation.
 */
export function addConnectionStateListener(listener) {
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
export function addSignalingStateListener(listener) {
    return LiquidAuthNativeModule.addListener('onSignalingStateChange', listener);
}
//# sourceMappingURL=index.js.map