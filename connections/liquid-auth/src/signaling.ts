/**
 * The structural seam over `@algorandfoundation/liquid-client`'s
 * `SignalClient` (and the RTC data channel it negotiates).
 *
 * Both roles receive their client through
 * {@link LiquidAuthOptions.createSignalClient | a factory}, so the
 * package tests headlessly (no socket.io, no WebRTC) and platform hosts
 * can substitute native-backed implementations.
 */

import { SignalClient } from "@algorandfoundation/liquid-client";

/**
 * The minimal `RTCDataChannel` surface the protocol drives, matched by
 * browser data channels and `react-native-webrtc`'s.
 */
export interface LiquidDataChannel {
  /** `connecting` / `open` / `closing` / `closed`. */
  readonly readyState: string;
  /** Sends a string frame to the remote peer. */
  send(data: string): void;
  /** Closes the channel. */
  close(): void;
  /** Message handler slot (`event.data` carries the frame). */
  onmessage: ((event: { data: unknown }) => void) | null;
  /** Open handler slot. */
  onopen: (() => void) | null;
  /** Close handler slot. */
  onclose: (() => void) | null;
}

/**
 * The liquid-extension payload the responder's `authSigner` completes
 * (address + ed25519 signature over the service challenge; see
 * `LiquidExtensionOptions` of `@algorandfoundation/liquid-client`).
 */
export interface LiquidAuthSignature {
  /**
   * The Algorand address authenticating the wallet. A base64(url)
   * 32-byte public key is also accepted; the responder normalizes it
   * to the canonical address (see `toAlgorandAddress`).
   */
  address: string;
  /** Base64url ed25519 signature over the service challenge. */
  signature: string;
  /** Optional device label shown by the service. */
  device?: string;
}

/**
 * The `SignalClient` surface the protocol consumes (structural subset of
 * `@algorandfoundation/liquid-client`'s class).
 */
export interface LiquidSignalClient {
  /** Whether the client authenticated against the signaling service. */
  authenticated: boolean;
  /**
   * Joins the `requestId` room and negotiates the peer connection.
   * `type` names the REMOTE description to wait for: the dapp passes
   * `offer` (waits for the wallet's offer, sends the answer), the
   * wallet passes `answer` (sends the offer, waits for the answer).
   */
  peer(
    requestId: string,
    type: "offer" | "answer",
    config?: unknown,
    options?: { dataChannels?: Record<string, unknown> },
  ): Promise<LiquidDataChannel>;
  /**
   * Liquid Auth attestation: fetches the service challenge, lets the
   * wallet sign it (the liquid extension), and registers via WebAuthn.
   */
  attestation(
    onChallenge: (challenge: Uint8Array) => Promise<Record<string, unknown>>,
  ): Promise<unknown>;
  /** Tears the client down (optionally disconnecting the socket). */
  close(disconnect?: boolean): void;
}

/**
 * A factory building the {@link LiquidSignalClient} for a signaling
 * origin.
 */
export type LiquidSignalClientFactory = (url: string) => LiquidSignalClient;

/**
 * The default factory: `@algorandfoundation/liquid-client`'s
 * `SignalClient` (socket.io + browser WebRTC).
 */
export function defaultSignalClientFactory(url: string): LiquidSignalClient {
  return new SignalClient(url) as unknown as LiquidSignalClient;
}

/**
 * Generates a Liquid Auth request id (uuid v7 via the client library).
 */
export function generateRequestId(): string {
  return SignalClient.generateRequestId();
}
