/**
 * The dapp-side (requesting) half of the Liquid Auth protocol.
 *
 * `createRequest()` drives the out-of-band flow: generate a `requestId`,
 * render the `liquid://` QR, and wait for the wallet to scan and answer.
 * `establish()` joins the signaling room, answers the wallet's WebRTC
 * offer, and resolves with the negotiated data-channel transport.
 * `resume()` renegotiates an already-paired session: the requester
 * rejoins the session's `requestId` room (parking on the liquid-auth
 * link rendezvous) and answers the wallet's fresh offer, with no new QR
 * and no new WebAuthn ceremony.
 */

import type {
  ConnectionRequest,
  ConnectionRequester,
  ConnectionSession,
  ConnectionTransport,
  ProtocolContext,
  ResumeOptions,
} from "@algorandfoundation/connections-core";

import { dataChannelTransport } from "./channel.ts";
import { LiquidAuthError } from "./errors.ts";
import {
  defaultSignalClientFactory,
  generateRequestId,
  type LiquidSignalClient,
  type LiquidSignalClientFactory,
} from "./signaling.ts";
import { buildLiquidUri } from "./uri.ts";

/**
 * Options of the Liquid Auth requester (dapp side).
 *
 * @example
 * ```typescript
 * const options: LiquidAuthRequesterOptions = { url: "https://liquid.example.com" };
 * ```
 */
export interface LiquidAuthRequesterOptions {
  /** The signaling server origin (e.g. `https://liquid.example.com`). */
  url: string;
  /** Signal client factory override (defaults to `SignalClient` of liquid-client). */
  createSignalClient?: LiquidSignalClientFactory;
  /** Request id factory override (defaults to uuid v7). */
  generateRequestId?: () => string;
  /** `RTCConfiguration` override forwarded to the peer negotiation. */
  rtcConfiguration?: unknown;
}

/** Races a promise against an abort signal. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(new LiquidAuthError("aborted", "connection attempt aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      onAbort?.();
      reject(new LiquidAuthError("aborted", "connection attempt aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Creates the Liquid Auth {@link ConnectionRequester}.
 *
 * @param options - {@link LiquidAuthRequesterOptions}.
 * @param ctx - The hosting engine's {@link ProtocolContext}.
 * @returns The requester.
 *
 * @example
 * ```typescript
 * const requester = createLiquidAuthRequester({ url: "https://liquid.example.com" }, { sessions: api });
 * const request = await requester.createRequest();
 * renderQr(request.qrData);
 * const transport = await request.establish();
 * ```
 */
export function createLiquidAuthRequester(
  options: LiquidAuthRequesterOptions,
  ctx: ProtocolContext,
): ConnectionRequester {
  const url = options.url;
  if (!url) {
    throw new LiquidAuthError("invalid_uri", "a signaling `url` is required on the requester side");
  }
  const createClient = options.createSignalClient ?? defaultSignalClientFactory;
  const newRequestId = options.generateRequestId ?? generateRequestId;

  /**
   * The shared peer negotiation of `establish()` and `resume()`: waits
   * for the wallet's offer, answers it, and wraps the resulting data
   * channel, wiring the session status (`connected` on open,
   * `disconnected` on close/abort, `failed` on error) along the way.
   */
  const negotiate = async (
    client: LiquidSignalClient,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionTransport> => {
    try {
      const channel = await abortable(
        // The dapp waits for the wallet's offer and answers it.
        client.peer(requestId, "offer", options.rtcConfiguration),
        signal,
        () => client.close(true),
      );
      const transport = dataChannelTransport(channel);
      transport.onStateChange((state) => {
        if (state === "open") {
          void ctx.sessions.updateSessionStatus(requestId, "connected");
        } else if (state === "closed") {
          void ctx.sessions.updateSessionStatus(requestId, "disconnected");
        }
      });
      if (transport.state === "open") {
        await ctx.sessions.updateSessionStatus(requestId, "connected");
      }
      return transport;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status =
        e instanceof LiquidAuthError && e.code === "aborted" ? "disconnected" : "failed";
      await ctx.sessions.updateSessionStatus(requestId, status, message);
      client.close(true);
      throw e;
    }
  };

  const createRequest = async (): Promise<ConnectionRequest> => {
    const requestId = newRequestId();
    const uri = buildLiquidUri(url, requestId);
    const client = createClient(url);
    const now = Date.now();
    await ctx.sessions.upsertSession({
      id: requestId,
      origin: url,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    let established: Promise<ConnectionTransport> | undefined;
    const establish = (opts: { signal?: AbortSignal } = {}): Promise<ConnectionTransport> => {
      // The underlying peer negotiation is single-shot; every caller of
      // establish() shares it.
      established ??= (async () => {
        await ctx.sessions.updateSessionStatus(requestId, "connecting");
        return negotiate(client, requestId, opts.signal);
      })();
      return established;
    };

    return { id: requestId, uri, qrData: uri, establish };
  };

  const resume = async (
    session: ConnectionSession,
    opts: ResumeOptions = {},
  ): Promise<ConnectionTransport> => {
    if (!session?.id) {
      throw new LiquidAuthError("invalid_session", "a session `id` is required to resume");
    }
    // The liquid-auth signaling session is origin-scoped: rejoin the
    // origin the session was created against (falls back to the
    // configured url for sessions persisted without one).
    const origin = session.origin || url;
    await ctx.sessions.upsertSession({
      ...session,
      origin,
      status: "connecting",
      updatedAt: Date.now(),
    });
    // A SignalClient is single-shot; every resume gets a fresh one.
    const client = createClient(origin);
    return negotiate(client, session.id, opts.signal);
  };

  return { createRequest, resume };
}
