import { base64urlnopad } from "@scure/base";

/**
 * Encodes the given bytes (or UTF-8 string) using base64url-without-padding,
 * the canonical encoding for JOSE / OID4VC structures.
 */
export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return base64urlnopad.encode(bytes);
}

/**
 * Decodes a base64url string (with or without padding) into raw bytes.
 */
export function base64UrlDecode(input: string): Uint8Array {
  // Strip any padding to be tolerant of both spec variants.
  const stripped = input.replace(/=+$/, "");
  return base64urlnopad.decode(stripped);
}

/**
 * Decodes a base64url string into a UTF-8 JavaScript string.
 */
export function base64UrlDecodeToString(input: string): string {
  return new TextDecoder().decode(base64UrlDecode(input));
}
