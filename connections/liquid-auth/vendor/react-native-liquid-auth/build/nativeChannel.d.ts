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
export declare class NativeDataChannel {
    readonly label: string;
    /** Mirrors `RTCDataChannel.bufferedAmount`; the native path never buffers in JS. */
    bufferedAmount: number;
    onopen: ((ev?: unknown) => void) | null;
    onclose: ((ev?: unknown) => void) | null;
    onerror: ((ev?: unknown) => void) | null;
    private _readyState;
    private readonly _send;
    private readonly _listeners;
    private _onmessage;
    private readonly _pending;
    private _flushScheduled;
    constructor(label: string, send: (label: string, message: string) => void);
    get readyState(): DataChannelReadyState;
    get onmessage(): ((ev: DataChannelMessageEvent) => void) | null;
    /** Attaching a message handler flushes anything buffered before it existed. */
    set onmessage(handler: ((ev: DataChannelMessageEvent) => void) | null);
    /** Send a frame over this channel through the native service. */
    send(data: string): void;
    /**
     * Locally mark the channel closed. There is no per-channel native close
     * (teardown happens via the service's `disconnect`), so this only flips the
     * local state and fires `close`, matching how consumers observe a closed
     * channel.
     */
    close(): void;
    addEventListener(type: ChannelEventType, listener: (ev?: unknown) => void): void;
    removeEventListener(type: ChannelEventType, listener: (ev?: unknown) => void): void;
    /** Route a native `onMessage` frame for this channel to the consumer. */
    dispatchMessage(message: string): void;
    /** Deliver a single message to the attached consumer(s). */
    private _deliver;
    /** Whether a message handler (`onmessage` or a `message` listener) exists. */
    private _hasMessageConsumer;
    /**
     * Schedule a deferred flush of the buffered backlog. Deferred to a microtask
     * (not synchronous) so a consumer that assigns `onmessage` and only then
     * wires its real inbound handlers — like the AC2 SDK's
     * `rtcDataChannelTransport` — has finished all of its synchronous setup
     * before the backlog is replayed, otherwise the replay would hit not-yet-set
     * handlers and be dropped. No-op if nothing is buffered or a flush is already
     * pending.
     */
    private _scheduleFlush;
    /** Flush (and clear) any messages buffered before a consumer attached. */
    private _flushPending;
    /**
     * Apply a native `onStateChange` for this channel. Transitions to `open`
     * fire `open`; transitions to `closed` fire `close`. The uppercase native
     * enum is lowercased to the `RTCDataChannel.readyState` union.
     */
    setState(state: string | null | undefined): void;
    /** Surface a native transport error to the consumer. */
    dispatchError(err?: unknown): void;
    private _fireOpen;
    private _fireClose;
    private _emit;
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
export declare class NativePeerConnection {
    iceConnectionState: string;
    connectionState: string;
    private readonly _listeners;
    addEventListener(type: string, listener: (ev?: unknown) => void): void;
    removeEventListener(type: string, listener: (ev?: unknown) => void): void;
    /**
     * Apply a native ICE connection-state change. The monitor treats
     * `iceConnectionState` as authoritative and only reads `connectionState` for
     * the terminal `failed`/`closed` states, so mirroring the same lowercased
     * value into both (and firing both events) satisfies it exactly.
     */
    setConnectionState(state: string | null | undefined): void;
    /** Mark the peer closed locally and notify the monitor. */
    close(): void;
    private _emit;
}
export {};
//# sourceMappingURL=nativeChannel.d.ts.map