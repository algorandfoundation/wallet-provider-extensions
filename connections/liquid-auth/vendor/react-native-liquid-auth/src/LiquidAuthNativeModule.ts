import { NativeModule, requireOptionalNativeModule } from 'expo';

import {
  IceServer,
  LiquidAuthConnectionState,
  LiquidAuthConnectOptions,
  LiquidAuthMessage,
  LiquidAuthNativeModuleEvents,
  LiquidAuthPeerType,
  LiquidAuthResponse,
} from './LiquidAuthNative.types';

declare class LiquidAuthNativeModule extends NativeModule<LiquidAuthNativeModuleEvents> {
  /**
   * Generate a random (time-based) request id.
   */
  generateRequestId(): string;

  /**
   * Parse a `liquid://<origin>/?requestId=<id>` URI (or JSON payload).
   */
  parseMessage(value: string): LiquidAuthMessage;

  /**
   * Start (and bind to) the background signaling service and connect the
   * signaling client to the given `origin`.
   */
  start(url: string): Promise<void>;

  /**
   * Connect to a remote peer by `requestId`.
   *
   * @param requestId the request id shared out of band (e.g. via a QR code)
   * @param type the *remote* peer type (`offer` or `answer`)
   * @param iceServers optional ICE server list (defaults to a public STUN server)
   * @param options optional connection options (e.g. named data channels)
   */
  connect(
    requestId: string,
    type: LiquidAuthPeerType,
    iceServers?: IceServer[],
    options?: LiquidAuthConnectOptions,
  ): Promise<void>;

  /**
   * Snapshot the background service's CURRENT connection so a re-attaching app
   * can hydrate instead of assuming a fresh start. Safe to call before the
   * service is bound (returns `connected: false`).
   */
  getConnectionState(): LiquidAuthConnectionState;

  /**
   * Re-attach to the ALREADY-live connection without renegotiating: rebind the
   * event listeners to this (fresh) JS runtime and re-emit the current channel
   * + ICE state so the app hydrates. Use when {@link getConnectionState}
   * reports `connected: true` (e.g. after a relaunch that reconnected to the
   * still-running service). `options` carries the same
   * `notifications`/`queueChannels`/`heartbeat` config as {@link connect}.
   */
  attach(options?: LiquidAuthConnectOptions): Promise<void>;

  /**
   * Abort an in-flight {@link connect} negotiation. The pending `connect`
   * promise rejects with an `E_ABORTED` error.
   */
  cancel(): Promise<void>;

  /**
   * Set whether the app is currently online (foregrounded, with its JS
   * listeners attached). The app owns this signal. Deliberately does NOT
   * replay the offline queue (a relaunching app flips active before its
   * listeners are rewired); replay happens when a fresh sink attaches
   * ({@link connect} / {@link attach}) or via an explicit {@link flushQueue}.
   */
  setActive(active: boolean): void;

  /**
   * Explicitly replay any messages the background service buffered while the
   * app was offline, through the `onMessage` event in arrival order. Call it
   * only once the JS message listeners are wired, so the replay can't race
   * the listener setup. No-op when nothing is buffered.
   */
  flushQueue(): void;

  /**
   * Send a message over the primary (`liquid`) data channel.
   */
  send(message: string): void;

  /**
   * Send a message over a specific named data channel.
   */
  sendToChannel(channel: string, message: string): void;

  /**
   * Stop the signaling client and unbind/stop the background service.
   */
  disconnect(): Promise<void>;

  /**
   * Perform an authenticated HTTP request through the module's shared
   * cookie-jar client (the same client that backs the background signaling
   * socket). Session cookies set by the response (e.g. `connect.sid`) are
   * captured natively, so a subsequent {@link start} authenticates
   * transparently. Lets a consumer run the whole Liquid Auth HTTP exchange
   * (attestation/assertion options + response, `/auth/session`) natively.
   *
   * @param url absolute request URL
   * @param method HTTP method (`GET`, `POST`, ...)
   * @param headers optional request headers
   * @param body optional request body (already serialized, e.g. JSON string)
   */
  request(
    url: string,
    method: string,
    headers?: Record<string, string>,
    body?: string,
  ): Promise<LiquidAuthResponse>;
}

/**
 * Stand-in used when the native module is absent from the binary (a mis-built
 * app, Expo Go, ...). Every method throws a descriptive — and, crucially,
 * CATCHABLE — error on invocation. `requireNativeModule` instead throws at
 * module evaluation, which kills the whole JS bundle; on iOS release builds
 * that is an uncatchable native abort, and once a paired session is persisted
 * it becomes a crash loop on every launch (the app auto-reconnects at
 * startup). This exact failure shipped in TestFlight builds 105–120.
 */
function createMissingModuleStub(): LiquidAuthNativeModule {
  return new Proxy({} as LiquidAuthNativeModule, {
    get(_target, prop) {
      // Benign answers for introspection (console.log, promise checks, JSON).
      if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'then') return undefined;
      return () => {
        throw new Error(
          `Native module 'LiquidAuthNative' is not present in this binary ` +
            `(called '${String(prop)}'). The app was built without ` +
            `modules/react-native-liquid-auth — rebuild the native app.`,
        );
      };
    },
  });
}

// Loads the native module object from the JSI, or the throwing stub when the
// binary does not include it.
export default requireOptionalNativeModule<LiquidAuthNativeModule>('LiquidAuthNative') ??
  createMissingModuleStub();
