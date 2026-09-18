/**
 * Shared display helpers for the demo panels: pure formatting only,
 * mirroring the web-keystore example's convention of keeping helpers out
 * of the rendering layer.
 */

/** Truncates long values (public keys, DIDs, ciphertexts) for display. */
export function truncate(value: string, head = 16, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Hex-encodes bytes for display. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
