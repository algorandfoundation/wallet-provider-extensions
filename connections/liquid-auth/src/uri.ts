/**
 * The `liquid://` request URI: the out-of-band (QR / deep-link) path of
 * the Liquid Auth protocol.
 *
 * Mirrors `generateDeepLink` of `@algorandfoundation/liquid-client`:
 * `liquid://<signaling-host>/?requestId=<uuid>`. The wallet resolves the
 * host back to an `https://` signaling origin and joins the `requestId`
 * room.
 */

import { LiquidAuthError } from "./errors.ts";

/** The scheme of a Liquid Auth request URI. */
export const LIQUID_URI_SCHEME: string = "liquid";

/**
 * The parsed contents of a `liquid://` request URI.
 */
export interface LiquidUri {
  /** The signaling server origin, normalized to `https://<host>`. */
  origin: string;
  /** The Liquid Auth request id (the signaling room to join). */
  requestId: string;
}

/**
 * Builds the `liquid://` request URI for a signaling origin and request id.
 *
 * @param origin - The signaling server origin (e.g. `https://liquid.example.com`).
 * @param requestId - The request id of the pending connection.
 * @returns The deep-linkable `liquid://` URI (also the QR payload).
 *
 * @example
 * ```typescript
 * buildLiquidUri("https://liquid.example.com", "0192...");
 * // => "liquid://liquid.example.com/?requestId=0192..."
 * ```
 */
export function buildLiquidUri(origin: string, requestId: string): string {
  if (typeof origin !== "string" || origin.length === 0) {
    throw new LiquidAuthError("invalid_uri", "origin is required to build a liquid:// URI");
  }
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new LiquidAuthError("invalid_uri", "requestId is required to build a liquid:// URI");
  }
  const host = origin.replace("https://", "");
  return `${LIQUID_URI_SCHEME}://${host}/?requestId=${encodeURIComponent(requestId)}`;
}

/**
 * Parses a `liquid://` request URI back into its signaling origin and
 * request id.
 *
 * @param uri - The URI to parse (e.g. scanned from a QR code).
 * @returns The parsed {@link LiquidUri}.
 * @throws {@link LiquidAuthError} with code `invalid_uri` when the URI
 * is malformed, has the wrong scheme, or is missing the `requestId`.
 *
 * @example
 * ```typescript
 * const { origin, requestId } = parseLiquidUri("liquid://liquid.example.com/?requestId=0192...");
 * ```
 */
export function parseLiquidUri(uri: string): LiquidUri {
  if (typeof uri !== "string" || !uri.startsWith(`${LIQUID_URI_SCHEME}://`)) {
    throw new LiquidAuthError("invalid_uri", `not a ${LIQUID_URI_SCHEME}:// URI: ${String(uri)}`);
  }
  let parsed: URL;
  try {
    // The liquid scheme is not a special scheme, so URL keeps the host
    // in the pathname on some runtimes; parse via an https mirror.
    parsed = new URL(uri.replace(`${LIQUID_URI_SCHEME}://`, "https://"));
  } catch {
    throw new LiquidAuthError("invalid_uri", `malformed ${LIQUID_URI_SCHEME}:// URI: ${uri}`);
  }
  const requestId = parsed.searchParams.get("requestId");
  if (!parsed.host || !requestId) {
    throw new LiquidAuthError(
      "invalid_uri",
      `missing host or requestId in ${LIQUID_URI_SCHEME}:// URI: ${uri}`,
    );
  }
  return {
    origin: `https://${parsed.host}`,
    requestId,
  };
}
