/**
 * Adapter shims that present `react-native-liquid-auth`'s *event-based* native
 * background service as the `RTCDataChannel`- and `RTCPeerConnection`-shaped
 * objects that connection code written against `react-native-webrtc` already
 * consumes.
 *
 * The native module owns the signaling socket + WebRTC peer in a foreground
 * service and only surfaces messages/state as events (`onMessage`,
 * `onStateChange`, `onConnectionStateChange`, ...). Consumers, however, are
 * frequently written against live `RTCDataChannel` objects from
 * `react-native-webrtc` (`.send`, `.readyState`, `.onmessage`,
 * `.addEventListener('open')`, `.bufferedAmount`) and a monitored
 * `RTCPeerConnection` (`.iceConnectionState`, `.addEventListener`).
 *
 * These shims bridge that gap so adopting the native service changes downstream
 * consumers minimally: a transport routes native events into per-channel shim
 * instances, and the shims re-emit them through the classic
 * DataChannel/PeerConnection APIs.
 *
 * The native side stringifies WebRTC enums verbatim, so states arrive
 * UPPERCASE (`OPEN`, `CLOSING`, `CONNECTED`, `FAILED`, ...); both shims
 * lowercase them to match the `RTCDataChannel.readyState` union and the ICE
 * states an ICE connection-state monitor expects.
 */

/** The `RTCDataChannel.readyState` union a transport wrapper expects. */
export type DataChannelReadyState = 'connecting' | 'open' | 'closing' | 'closed';

/** Shape of the message event a `.onmessage` handler reads. */
export interface DataChannelMessageEvent {
  data: string;
}

type ChannelEventType = 'open' | 'close' | 'error' | 'message';
type PeerEventType = 'iceconnectionstatechange' | 'connectionstatechange';

/**
 * Lowercase a native WebRTC enum string (e.g. `"OPEN"` -> `"open"`), tolerating
 * a `null`/`undefined` state by treating it as `closed` (the native side sends
 * `null` when a channel/peer has no meaningful state left).
 */
function normalizeState(state: string | null | undefined): string {
  return (state ?? 'closed').toLowerCase();
}

/**
 * An `RTCDataChannel`-shaped adapter backed by the native background service.
 *
 * A single instance represents one named channel (e.g. `ac2-v1`). The owning
 * transport factory feeds it native events via {@link dispatchMessage} /
 * {@link setState}; consumers interact with it exactly as they would a real
 * `RTCDataChannel`.
 *
 * Both the property-style handlers (`onopen`/`onmessage`/...) and the
 * `addEventListener` style are supported.
 */
export class NativeDataChannel {
  readonly label: string;

  /** Mirrors `RTCDataChannel.bufferedAmount`; the native path never buffers in JS. */
  bufferedAmount = 0;

  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  private _readyState: DataChannelReadyState = 'connecting';
  private readonly _send: (label: string, message: string) => void;
  private readonly _listeners = new Map<ChannelEventType, Set<(ev?: unknown) => void>>();
  // Backing field for the `onmessage` accessor. Using a setter (rather than a
  // plain field) lets us flush any messages buffered before a consumer
  // attached — see `dispatchMessage`.
  private _onmessage: ((ev: DataChannelMessageEvent) => void) | null = null;
  // Messages that arrived before a consumer (`onmessage` or a `message`
  // listener) was attached. This happens on the hydrate/attach path: the
  // background service replays its offline queue during `attach()`, which can
  // fire before the SDK client wires `onmessage` on the control channel. We
  // buffer here and flush once a consumer attaches so no replayed request
  // (message received while the app was closed) is ever lost.
  private readonly _pending: string[] = [];
  // Whether a flush of `_pending` is already scheduled on the microtask queue.
  // The flush is deferred (not synchronous) because a consumer such as the AC2
  // SDK's `rtcDataChannelTransport` assigns `onmessage` FIRST and only then
  // registers its real inbound handlers (`onMessage`/`onRawMessage`) on the
  // very next lines. A synchronous flush would replay the buffered messages
  // through that `onmessage` bridge while its downstream handlers are still
  // null, silently dropping them. Deferring to a microtask lets the consumer
  // finish wiring (all synchronous) before the backlog is delivered.
  private _flushScheduled = false;

  constructor(label: string, send: (label: string, message: string) => void) {
    this.label = label;
    this._send = send;
  }

  get readyState(): DataChannelReadyState {
    return this._readyState;
  }

  get onmessage(): ((ev: DataChannelMessageEvent) => void) | null {
    return this._onmessage;
  }

  /** Attaching a message handler flushes anything buffered before it existed. */
  set onmessage(handler: ((ev: DataChannelMessageEvent) => void) | null) {
    this._onmessage = handler;
    if (handler) this._scheduleFlush();
  }

  /** Send a frame over this channel through the native service. */
  send(data: string): void {
    this._send(this.label, data);
  }

  /**
   * Locally mark the channel closed. There is no per-channel native close
   * (teardown happens via the service's `disconnect`), so this only flips the
   * local state and fires `close`, matching how consumers observe a closed
   * channel.
   */
  close(): void {
    if (this._readyState === 'closed') return;
    this._readyState = 'closed';
    this._fireClose();
  }

  addEventListener(type: ChannelEventType, listener: (ev?: unknown) => void): void {
    const set = this._listeners.get(type) ?? new Set();
    set.add(listener);
    this._listeners.set(type, set);
    // A newly attached message consumer flushes anything buffered before it.
    if (type === 'message') this._scheduleFlush();
  }

  removeEventListener(type: ChannelEventType, listener: (ev?: unknown) => void): void {
    this._listeners.get(type)?.delete(listener);
  }

  /** Route a native `onMessage` frame for this channel to the consumer. */
  dispatchMessage(message: string): void {
    // Buffer when there is no consumer yet (e.g. the SDK client hasn't wired
    // `onmessage` on the control channel during hydrate) OR when a deferred
    // flush of earlier buffered messages is still pending — appending keeps
    // delivery in strict arrival order rather than letting a live frame jump
    // ahead of the backlog. The scheduled flush drains everything in order.
    if (!this._hasMessageConsumer() || this._pending.length > 0 || this._flushScheduled) {
      this._pending.push(message);
      if (this._hasMessageConsumer()) this._scheduleFlush();
      return;
    }
    this._deliver(message);
  }

  /** Deliver a single message to the attached consumer(s). */
  private _deliver(message: string): void {
    const event: DataChannelMessageEvent = { data: message };
    try {
      this._onmessage?.(event);
    } catch {
      /* consumer handler threw; do not break dispatch */
    }
    this._emit('message', event);
  }

  /** Whether a message handler (`onmessage` or a `message` listener) exists. */
  private _hasMessageConsumer(): boolean {
    return this._onmessage != null || (this._listeners.get('message')?.size ?? 0) > 0;
  }

  /**
   * Schedule a deferred flush of the buffered backlog. Deferred to a microtask
   * (not synchronous) so a consumer that assigns `onmessage` and only then
   * wires its real inbound handlers — like the AC2 SDK's
   * `rtcDataChannelTransport` — has finished all of its synchronous setup
   * before the backlog is replayed, otherwise the replay would hit not-yet-set
   * handlers and be dropped. No-op if nothing is buffered or a flush is already
   * pending.
   */
  private _scheduleFlush(): void {
    if (this._flushScheduled || this._pending.length === 0) return;
    this._flushScheduled = true;
    const run = () => {
      this._flushScheduled = false;
      this._flushPending();
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(run);
    } else {
      void Promise.resolve().then(run);
    }
  }

  /** Flush (and clear) any messages buffered before a consumer attached. */
  private _flushPending(): void {
    if (this._pending.length === 0) return;
    const buffered = this._pending.splice(0, this._pending.length);
    for (const message of buffered) this._deliver(message);
  }

  /**
   * Apply a native `onStateChange` for this channel. Transitions to `open`
   * fire `open`; transitions to `closed` fire `close`. The uppercase native
   * enum is lowercased to the `RTCDataChannel.readyState` union.
   */
  setState(state: string | null | undefined): void {
    const next = normalizeState(state);
    const readyState = (['connecting', 'open', 'closing', 'closed'] as const).includes(
      next as DataChannelReadyState,
    )
      ? (next as DataChannelReadyState)
      : 'closed';
    if (readyState === this._readyState) return;
    this._readyState = readyState;
    if (readyState === 'open') this._fireOpen();
    else if (readyState === 'closed') this._fireClose();
  }

  /** Surface a native transport error to the consumer. */
  dispatchError(err?: unknown): void {
    try {
      this.onerror?.(err);
    } catch {
      /* consumer handler threw; do not break dispatch */
    }
    this._emit('error', err);
  }

  private _fireOpen(): void {
    try {
      this.onopen?.();
    } catch {
      /* noop */
    }
    this._emit('open');
  }

  private _fireClose(): void {
    try {
      this.onclose?.();
    } catch {
      /* noop */
    }
    this._emit('close');
  }

  private _emit(type: ChannelEventType, ev?: unknown): void {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(ev);
      } catch {
        /* listener threw; keep dispatching */
      }
    }
  }
}

/**
 * An `RTCPeerConnection`-shaped adapter exposing only the surface an ICE
 * connection-state monitor reads: `iceConnectionState`, `connectionState`, and
 * `addEventListener`/`removeEventListener` for the two state-change events.
 *
 * The native service reports a single ICE connection state string via
 * `onConnectionStateChange`; it is lowercased into `iceConnectionState` (and
 * mirrored into `connectionState`) and re-emitted so the monitor's failure
 * detection works unchanged.
 */
export class NativePeerConnection {
  iceConnectionState = 'new';
  connectionState = 'new';

  private readonly _listeners = new Map<PeerEventType, Set<(ev?: unknown) => void>>();

  addEventListener(type: string, listener: (ev?: unknown) => void): void {
    const key = type as PeerEventType;
    const set = this._listeners.get(key) ?? new Set();
    set.add(listener);
    this._listeners.set(key, set);
  }

  removeEventListener(type: string, listener: (ev?: unknown) => void): void {
    this._listeners.get(type as PeerEventType)?.delete(listener);
  }

  /**
   * Apply a native ICE connection-state change. The monitor treats
   * `iceConnectionState` as authoritative and only reads `connectionState` for
   * the terminal `failed`/`closed` states, so mirroring the same lowercased
   * value into both (and firing both events) satisfies it exactly.
   */
  setConnectionState(state: string | null | undefined): void {
    const next = normalizeState(state);
    this.iceConnectionState = next;
    this.connectionState = next;
    this._emit('iceconnectionstatechange');
    this._emit('connectionstatechange');
  }

  /** Mark the peer closed locally and notify the monitor. */
  close(): void {
    if (this.iceConnectionState === 'closed' && this.connectionState === 'closed') return;
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
    this._emit('iceconnectionstatechange');
    this._emit('connectionstatechange');
  }

  private _emit(type: PeerEventType): void {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        /* listener threw; keep dispatching */
      }
    }
  }
}
