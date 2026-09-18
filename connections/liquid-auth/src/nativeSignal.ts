/**
 * The binding between the Liquid Auth protocol and
 * `react-native-liquid-auth`'s background `SignalService`.
 *
 * The native module is **injected** through the structural
 * {@link NativeSignalModuleLike} seam, so this adapter stays testable
 * without native code. {@link createNativeSignalClientFactory} produces
 * the `createSignalClient` seam of the responder options for the
 * foreground QR-accept path: the wallet scans/pastes a `liquid://`
 * URI, the engine `accept()`s it, and the native service carries the
 * signaling socket and the WebRTC peer (no JS WebRTC polyfill needed).
 *
 * Exposed through the package's `react-native` export condition (see
 * `./index.native.ts`, which also prewires the seam to the vendored
 * `react-native-liquid-auth` module).
 */

/**
 * The subset of `react-native-liquid-auth`'s module surface this
 * adapter consumes (structural, so tests inject doubles).
 */
export interface NativeSignalModuleLike {
  /** Starts (and binds) the background service against a signaling origin. */
  start(url: string): Promise<void>;
  /** Connects to the remote peer by `requestId` (same type semantics as `SignalClient.peer`). */
  connect(
    requestId: string,
    type: "offer" | "answer",
    iceServers?: unknown[],
    options?: Record<string, unknown>,
  ): Promise<void>;
  /** Sends over the primary (`liquid`) data channel. */
  send(message: string): void;
  /** Sends over a specific named data channel. */
  sendToChannel?(channel: string, message: string): void;
  /** Subscribes to inbound data-channel messages. */
  addMessageListener(listener: (event: { channel: string; message: string }) => void): {
    remove(): void;
  };
  /** Subscribes to data-channel state changes (`OPEN`, `CLOSED`, ...). */
  addStateChangeListener(listener: (event: { channel: string; state: string | null }) => void): {
    remove(): void;
  };
  /** Subscribes to peer ICE connection-state changes (`CONNECTED`, `DISCONNECTED`, `FAILED`, ...). */
  addConnectionStateListener?(listener: (event: { state: string }) => void): {
    remove(): void;
  };
  /** Stops the signaling client and the background service. */
  disconnect?(): Promise<void>;
}

/**
 * An RTC-`DataChannel`-shaped view over one named channel of the native
 * service, structurally compatible with the {@link LiquidDataChannel}
 * seam of `./signaling.ts`.
 */
export interface NativeServiceChannel {
  readonly label: string;
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
}

/** Lowercases a native WebRTC enum string (`"OPEN"` → `"open"`). */
function normalizeState(state: string | null | undefined): string {
  return (state ?? "closed").toLowerCase();
}

/**
 * Wraps one named channel of the native service as a
 * {@link NativeServiceChannel}.
 *
 * @param module - The injected native module surface.
 * @param label - The channel label (defaults to `liquid`).
 * @param initialState - The channel's current native state.
 * @returns The channel adapter plus a `detach()` removing the module
 * listeners and a `discard()` that additionally closes the channel
 * locally (for retiring a stale adapter when a newer negotiation
 * replaces it).
 */
export function nativeServiceChannel(
  module: NativeSignalModuleLike,
  label = "liquid",
  initialState: string | null = "OPEN",
): { channel: NativeServiceChannel; detach(): void; discard(): void } {
  let readyState = normalizeState(initialState);

  const channel: NativeServiceChannel = {
    label,
    get readyState(): string {
      return readyState;
    },
    send(data: string): void {
      if (label !== "liquid" && module.sendToChannel) {
        module.sendToChannel(label, data);
        return;
      }
      module.send(data);
    },
    close(): void {
      // There is no per-channel native close (teardown happens via the
      // service's disconnect); flip the local state and notify.
      if (readyState === "closed") return;
      readyState = "closed";
      channel.onclose?.();
      void module.disconnect?.();
    },
    onmessage: null,
    onopen: null,
    onclose: null,
  };

  const messageSub = module.addMessageListener((event) => {
    if (event.channel !== label) return;
    channel.onmessage?.({ data: event.message });
  });
  const stateSub = module.addStateChangeListener((event) => {
    if (event.channel !== label) return;
    const next = normalizeState(event.state);
    if (next === readyState) return;
    readyState = next === "closing" ? "closed" : next;
    if (readyState === "open") channel.onopen?.();
    else if (readyState === "closed") channel.onclose?.();
  });
  // ICE-drop bookkeeping: when the peer connection reports
  // `disconnected`/`failed`, close the adapter locally so the transport's
  // close (and the engine's `disconnected` session status) fires promptly
  // instead of waiting on a data-channel CLOSED event that a dead peer
  // may never deliver. Deliberately does NOT stop the native service:
  // the signaling socket stays up, so server presence keeps flowing and
  // the presence-driven auto-resume can re-offer.
  const connectionSub = module.addConnectionStateListener?.((event) => {
    const state = normalizeState(event.state);
    if (state !== "disconnected" && state !== "failed" && state !== "closed") return;
    if (readyState === "closed") return;
    readyState = "closed";
    channel.onclose?.();
  });

  const detach = (): void => {
    messageSub.remove();
    stateSub.remove();
    connectionSub?.remove();
  };

  return {
    channel,
    detach,
    /**
     * Retires the adapter when a newer negotiation replaces it: removes
     * the module listeners and closes the channel LOCALLY (firing
     * `onclose` so the transport above tears down and stops answering)
     * WITHOUT stopping the native service the replacement runs on.
     */
    discard(): void {
      detach();
      if (readyState === "closed") return;
      readyState = "closed";
      channel.onclose?.();
    },
  };
}

/**
 * A native-service-backed stand-in for liquid-client's `SignalClient`,
 * structurally compatible with the {@link LiquidSignalClient} seam of
 * `./signaling.ts`, so it plugs into `liquidAuth({ createSignalClient })`
 * directly. The WebRTC peer and the signaling socket live in the
 * background `SignalService`, so no JS WebRTC polyfill is needed.
 */
export interface NativeSignalClient {
  authenticated: boolean;
  peer(
    requestId: string,
    type: "offer" | "answer",
    config?: unknown,
    options?: { dataChannels?: Record<string, unknown> },
  ): Promise<NativeServiceChannel>;
  attestation(
    onChallenge: (challenge: Uint8Array) => Promise<Record<string, unknown>>,
  ): Promise<unknown>;
  close(disconnect?: boolean): void;
}

/**
 * Options accepted by {@link createNativeSignalClientFactory}.
 */
export interface NativeSignalClientFactoryOptions {
  /** The channel label the transport binds; defaults to `liquid`. */
  channel?: string;
  /** Extra native connect options (`notifications`/`queueChannels`/`heartbeat`/`dataChannels`). */
  connectOptions?: Record<string, unknown>;
}

/**
 * Builds the `createSignalClient` seam for the responder, backed by
 * the native `SignalService` instead of liquid-client's browser
 * `SignalClient`.
 *
 * Authentication against the liquid-auth service is a native concern
 * here (the module's cookie-jar `request()` shares its session with the
 * background socket), so the returned client's `attestation()` throws;
 * hosts either authenticate natively beforehand or pass an
 * `authenticate` override to `liquidAuth({...})`.
 */
export function createNativeSignalClientFactory(
  module: NativeSignalModuleLike,
  options: NativeSignalClientFactoryOptions = {},
): (url: string) => NativeSignalClient {
  const label = options.channel ?? "liquid";
  // The native service carries ONE peer connection per channel label: a
  // new negotiation replaces the previous one natively, so the factory
  // retires the previously bound adapter whenever a fresh `peer()` binds.
  // Without this, every stale adapter keeps a live module listener and
  // its transport keeps answering the shared channel, so one dapp request
  // would raise one approval dialog PER past negotiation.
  const active = new Map<string, { discard(): void }>();
  return (url: string): NativeSignalClient => {
    let bound: ReturnType<typeof nativeServiceChannel> | undefined;
    const client: NativeSignalClient = {
      authenticated: false,
      async peer(
        requestId: string,
        type: "offer" | "answer",
        config?: unknown,
        peerOptions?: { dataChannels?: Record<string, unknown> },
      ): Promise<NativeServiceChannel> {
        // Retire the previous negotiation's adapter BEFORE the fresh one
        // starts, so its listeners never observe the new channel's events.
        active.get(label)?.discard();
        active.delete(label);
        await module.start(url);
        // Wire the adapter BEFORE the negotiation completes so no
        // channel event is missed.
        bound = nativeServiceChannel(module, label, "CONNECTING");
        active.set(label, bound);
        // Honor the responder's `rtcConfiguration` seam: forward its ICE
        // servers (STUN/TURN) to the native peer negotiation.
        const iceServers = (config as { iceServers?: unknown[] } | null | undefined)?.iceServers;
        await module.connect(requestId, type, iceServers, {
          ...options.connectOptions,
          ...(peerOptions?.dataChannels ? { dataChannels: peerOptions.dataChannels } : {}),
        });
        return bound.channel;
      },
      async attestation(): Promise<unknown> {
        throw new Error(
          "the native SignalService authenticates through the module's cookie-jar request(); " +
            "run the liquid-auth HTTP exchange natively or pass an `authenticate` override",
        );
      },
      close(disconnect?: boolean): void {
        if (bound) {
          bound.detach();
          if (active.get(label) === bound) active.delete(label);
        }
        if (disconnect) void module.disconnect?.();
      },
    };
    return client;
  };
}
