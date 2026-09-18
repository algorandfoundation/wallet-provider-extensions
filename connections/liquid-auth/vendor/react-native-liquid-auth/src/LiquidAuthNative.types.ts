// Public types for the Liquid Auth native bindings.

/**
 * The type of the *remote* peer we are connecting to.
 * - `answer`: the local device creates the offer (acts as the offerer)
 * - `offer`: the local device waits for the offer and answers it
 */
export type LiquidAuthPeerType = 'offer' | 'answer';

/**
 * A single ICE server configuration passed to the WebRTC peer connection.
 */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Configuration for a single named data channel, mirroring the
 * `RTCDataChannelInit` options accepted by `liquid-auth-js`.
 */
export interface DataChannelInit {
  ordered?: boolean;
  maxRetransmits?: number;
  maxPacketLifeTime?: number;
  protocol?: string;
  negotiated?: boolean;
  id?: number;
  /**
   * Creation-order rank (lower first). Channel maps cross the iOS bridge as
   * unordered dictionaries, but the remote peer observes channels in creation
   * order — set this when the protocol requires a specific channel (e.g. a
   * control channel) to be announced first.
   */
  order?: number;
}

/**
 * A single notification template the native background service uses to render
 * the ongoing notification while the app is backgrounded.
 */
export interface NotificationTemplate {
  /** Notification title. When omitted, the ongoing notification's title is kept. */
  title?: string;
  /** Notification body text. When omitted, the raw message is used. */
  body?: string;
}

/**
 * Copy for the single ongoing foreground-service notification, whose text
 * reflects the service state while the app is backgrounded (or its JS runtime
 * is suspended/killed): connected (app foreground), idle (app closed with
 * nothing waiting — "tap to open"), or messages (message[s] arrived while
 * closed — "you have new messages"). The consumer owns all copy so the shared
 * library stays content-agnostic; the native service renders it, so it works
 * even when the JS runtime is not running.
 */
export interface NotificationConfig {
  /**
   * Channel labels whose inbound messages do NOT flip the notification into
   * the `messages` state (control traffic such as `ac2-heartbeat`/`ac2-stream`).
   * They are still buffered/replayed, just not announced.
   */
  suppressChannels?: string[];
  /** Ongoing notification while the app is foreground/connected. */
  connected?: NotificationTemplate;
  /** Ongoing notification while the app is closed with no pending messages. */
  idle?: NotificationTemplate;
  /** Ongoing notification while the app is closed with pending messages. */
  messages?: NotificationTemplate;
}

/**
 * Heartbeat keep-alive configuration. While the app is offline (its JS runtime
 * is suspended / it has been backgrounded or closed) the background service
 * itself answers the peer's keepalive `ping` on {@link channel} with a `pong`,
 * so the peer's liveness watchdog stays satisfied and does not tear the
 * connection down while the app is away. The JS ping/pong reply only runs while
 * the app is foregrounded, so this native reply covers the backgrounded case.
 * The consumer supplies the channel + tokens so the shared library never
 * hardcodes them.
 */
export interface HeartbeatConfig {
  /** The data-channel label the keepalive ping/pong is exchanged on. */
  channel: string;
  /** The inbound token that triggers a reply (default `ping`). */
  ping?: string;
  /** The token sent back in reply (default `pong`). */
  pong?: string;
}

/**
 * Extra options for {@link connect}, mirroring the `options` argument of the
 * `SignalClient.peer()` method in `liquid-auth-js`.
 */
export interface LiquidAuthConnectOptions {
  /**
   * Named data channels to open, keyed by label (e.g. `ac2-v1`,
   * `ac2-stream`). Only used when acting as the offerer (`type: 'answer'`).
   * Defaults to a single `liquid` channel.
   */
  dataChannels?: Record<string, DataChannelInit>;
  /**
   * Notification content: the ongoing notification reflects the connected /
   * idle ("tap to open") / new-messages states. When omitted, the native
   * service falls back to showing the raw message text for every channel.
   */
  notifications?: NotificationConfig;
  /**
   * Data-channel labels whose inbound messages the background service buffers
   * while the app is offline (its JS listener is not attached) and replays via
   * `onMessage` once it comes back online (see `setActive`). When omitted,
   * messages on every channel are buffered; pass an explicit list to buffer
   * only the channels that carry deliverable app requests (e.g. `ac2-v1`,
   * `ac2-stream`) and skip pure control traffic (e.g. `ac2-heartbeat`).
   */
  queueChannels?: string[];
  /**
   * Heartbeat keep-alive: while the app is offline the background service
   * answers the peer's keepalive `ping` on the given channel with a `pong`,
   * so the connection survives being backgrounded (the JS ping/pong reply is
   * dead then). When omitted, no native keep-alive is performed.
   */
  heartbeat?: HeartbeatConfig;
}

/**
 * A parsed `liquid://<origin>/?requestId=<id>` message.
 */
export interface LiquidAuthMessage {
  origin: string;
  requestId: string;
}

/**
 * Payload emitted for every data-channel message received from the peer.
 * `channel` is the label of the data channel the message arrived on.
 */
export interface LiquidAuthMessageEvent {
  channel: string;
  message: string;
}

/**
 * Payload emitted when a data-channel state changes
 * (e.g. `OPEN`, `CLOSING`, `CLOSED`). `channel` is the label of the affected
 * data channel.
 */
export interface LiquidAuthStateChangeEvent {
  channel: string;
  state: string | null;
}

/**
 * Payload emitted when a remote media track is added to the connection.
 */
export interface LiquidAuthTrackEvent {
  id: string;
  kind: string;
  enabled: boolean;
}

/**
 * Payload emitted for server-broadcast `presence` updates, mirroring the
 * `PresenceResult` shape the wallet consumes: how many devices are currently
 * connected for the `requestId`.
 */
export interface LiquidAuthPresenceEvent {
  requestId: string;
  deviceCount: number;
  online: boolean;
}

/**
 * Payload emitted when the signaling server rejects the link for a `requestId`
 * (e.g. the two-peer lockdown `link-error` room refusal). Forwarded from the
 * signaling socket's `exception` event.
 */
export interface LiquidAuthLinkErrorEvent {
  /** The originating signaling event, typically `link-error`. */
  event?: string;
  /** The `requestId` the refusal applies to, when present. */
  requestId?: string;
  /** Machine-readable reason, e.g. `room-full` / `duplicate-peer`. */
  reason?: string;
  /** Human-readable message from the server. */
  message?: string;
}

/**
 * Payload emitted when the peer connection's ICE connection state changes
 * (e.g. `CONNECTED`, `DISCONNECTED`, `FAILED`).
 */
export interface LiquidAuthConnectionStateEvent {
  state: string;
}

/**
 * Payload emitted when the persistent signaling socket's connectivity changes
 * (including socket.io auto-reconnects). Independent of the p2p connection —
 * the data channels deliberately survive signaling disruptions — so consumers
 * can surface a dedicated "signaling server offline" state.
 */
export interface LiquidAuthSignalingStateEvent {
  state: 'connected' | 'disconnected';
}

/**
 * The result of an authenticated {@link request} performed through the native
 * module's shared cookie-jar HTTP client (the same client that backs the
 * background signaling socket). `body` is the raw response text; callers parse
 * JSON themselves.
 */
export interface LiquidAuthResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
}

/**
 * A snapshot of the background service's CURRENT connection, returned by
 * `getConnectionState`, so a re-attaching app can hydrate its UI (instead of
 * assuming a fresh start / showing "Connecting…") when it reconnects to a
 * still-running service.
 */
export interface LiquidAuthConnectionState {
  /** Whether a peer connection with negotiated data channels currently exists. */
  connected: boolean;
  /** The `requestId` the live connection is bound to, or `null` when none. */
  requestId: string | null;
  /**
   * The peer's ICE connection state (`CONNECTED`, `DISCONNECTED`, `FAILED`,
   * ...), or `null` when there is no peer connection.
   */
  iceConnectionState: string | null;
  /**
   * Each negotiated channel's current state (`OPEN`, `CLOSING`, `CLOSED`, ...),
   * keyed by channel label.
   */
  channels: Record<string, string>;
  /**
   * Whether the persistent signaling socket is currently connected,
   * independent of the p2p state above. Lets a (re)attaching app seed its
   * "signaling offline" indicator before the first `onSignalingStateChange`
   * event arrives.
   */
  signalingConnected: boolean;
  /**
   * The last server `presence` broadcast the persistent socket received, or
   * `null`/absent before the first one (or on an older native binary). The
   * server broadcasts presence when this socket joins the `requestId` room —
   * typically during service start, BEFORE the consumer's JS `onPresence`
   * listener is attached — and then stays silent until a device joins or
   * leaves, so this snapshot field is the only way a launching app can learn
   * its peer is offline. Cleared on an explicit stop; survives socket blips
   * (the server rebroadcasts on reconnect, overwriting it).
   */
  lastPresence?: LiquidAuthPresenceEvent | null;
}

/**
 * Events emitted by the native module.
 */
export type LiquidAuthNativeModuleEvents = {
  onMessage: (event: LiquidAuthMessageEvent) => void;
  onStateChange: (event: LiquidAuthStateChangeEvent) => void;
  onTrack: (event: LiquidAuthTrackEvent) => void;
  onPresence: (event: LiquidAuthPresenceEvent) => void;
  onLinkError: (event: LiquidAuthLinkErrorEvent) => void;
  onConnectionStateChange: (event: LiquidAuthConnectionStateEvent) => void;
  onSignalingStateChange: (event: LiquidAuthSignalingStateEvent) => void;
};
