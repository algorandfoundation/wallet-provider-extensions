import { parseLiquidUri } from "@algorandfoundation/connections";

/**
 * A QR payload the generic (home-screen) scanner knows how to route.
 *
 * - `fido`: a WebAuthn cross-device (hybrid / caBLE) QR code, the
 *   `FIDO:/<digits>` URI a browser shows under "Use a passkey on another
 *   device". Dispatching it as a VIEW intent hands it to Google Play
 *   services (`com.google.android.gms/.fido.authenticator.ui.QRBounceActivity`),
 *   which tunnels to the browser and serves the assertion through Android
 *   Credential Manager, i.e. through this wallet's credential provider
 *   when it is enabled.
 * - `liquid`: a `liquid://` connection request URI, Liquid Auth's
 *   cross-device fallback (routed to the Connections screen).
 */
export type ScannedPayload = { kind: "fido"; data: string } | { kind: "liquid"; data: string };

/** The `FIDO:/` hybrid-transport QR scheme (case-insensitive, numeric payload). */
const FIDO_URI_PATTERN: RegExp = /^fido:\/\d+$/i;

/**
 * Classify a scanned QR payload, or return `null` when it is neither a
 * FIDO hybrid QR nor a `liquid://` connection request.
 */
export function classifyScannedPayload(data: string): ScannedPayload | null {
  const trimmed = data.trim();
  if (FIDO_URI_PATTERN.test(trimmed)) return { kind: "fido", data: trimmed };
  try {
    parseLiquidUri(trimmed);
    return { kind: "liquid", data: trimmed };
  } catch {
    return null;
  }
}
