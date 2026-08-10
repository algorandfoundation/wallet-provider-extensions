/**
 * @module ows/errors
 *
 * Error translation between the Open Wallet Standard and the keystore.
 *
 * The OWS agent access layer requires an adapter to surface core errors without
 * rewriting a denial into a success or a silent fallback, so every failure is
 * re-thrown: {@link toKeyStoreError} only *classifies* it, mapping the OWS
 * canonical error codes onto the keystore error family while keeping the
 * original error as `cause`.
 */

import { KeyNotFoundError, KeyStoreError } from "@algorandfoundation/keystore-core";

/** The canonical OWS error codes, as defined by the signing interface. */
export const OWS_ERROR_CODES = [
  "WALLET_NOT_FOUND",
  "CHAIN_NOT_SUPPORTED",
  "INVALID_PASSPHRASE",
  "INVALID_INPUT",
  "CAIP_PARSE_ERROR",
  "POLICY_DENIED",
  "API_KEY_NOT_FOUND",
  "API_KEY_EXPIRED",
] as const;

/** One of the canonical {@link OWS_ERROR_CODES}, or an implementation-specific code. */
export type OwsErrorCode = (typeof OWS_ERROR_CODES)[number] | string;

/**
 * An error raised by an OWS access layer, carrying its canonical
 * {@link OwsErrorCode} so callers can branch on the standard code instead of
 * matching free-form message text.
 */
export class OwsError extends KeyStoreError {
  /** The canonical OWS error code. */
  readonly code: OwsErrorCode;

  /**
   * @param code - The canonical OWS error code.
   * @param message - The message reported by the OWS surface.
   * @param cause - The underlying error, if any.
   */
  constructor(code: OwsErrorCode, message: string, cause?: Error) {
    super(`OWS ${code}: ${message}`, "OwsError", cause);
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OwsError);
    }
  }
}

/**
 * Error thrown when a keystore operation has no equivalent in OWS.
 *
 * OWS is a *custodian and signer*: it owns the seed, never hands raw material
 * to the orchestrator and exposes no verification primitive, so the parts of
 * the {@link import("@algorandfoundation/keystore-core").KeyStoreAPI} that
 * require either are refused loudly rather than emulated.
 */
export class OwsUnsupportedOperationError extends KeyStoreError {
  /**
   * @param operation - The keystore operation that has no OWS equivalent.
   * @param reason - Why OWS cannot serve it.
   * @param cause - The underlying error, if any.
   */
  constructor(operation: string, reason: string, cause?: Error) {
    super(`OWS cannot perform ${operation}: ${reason}`, "OwsUnsupportedOperationError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OwsUnsupportedOperationError);
    }
  }
}

/** Message fragments the OWS surfaces print for each canonical code. */
const CODE_PATTERNS: ReadonlyArray<readonly [OwsErrorCode, RegExp]> = [
  ["WALLET_NOT_FOUND", /wallet[\s_-]?not[\s_-]?found|no wallet (?:named|with)/i],
  ["POLICY_DENIED", /policy[\s_-]?denied|denied by policy/i],
  ["INVALID_PASSPHRASE", /invalid[\s_-]?passphrase|wrong passphrase|bad passphrase/i],
  ["API_KEY_EXPIRED", /api[\s_-]?key[\s_-]?expired|key has expired/i],
  ["API_KEY_NOT_FOUND", /api[\s_-]?key[\s_-]?not[\s_-]?found/i],
  ["CHAIN_NOT_SUPPORTED", /chain[\s_-]?not[\s_-]?supported|unsupported chain/i],
  ["CAIP_PARSE_ERROR", /caip[\s_-]?parse[\s_-]?error/i],
  ["INVALID_INPUT", /invalid[\s_-]?input/i],
];

/**
 * Extracts the canonical {@link OwsErrorCode} an OWS surface reported.
 *
 * Both access profiles are covered: the NAPI bindings expose a `code` property,
 * while the CLI prints the code (or its human phrasing) on stderr.
 *
 * @param error - The failure raised by the access layer.
 * @returns The canonical code, or `undefined` when it cannot be identified.
 *
 * @example
 * ```typescript
 * owsErrorCode(new Error("error: policy denied: chain eip155:1 not in allowlist"));
 * // => "POLICY_DENIED"
 * ```
 */
export function owsErrorCode(error: unknown): OwsErrorCode | undefined {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && code.length > 0) return code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  for (const [candidate, pattern] of CODE_PATTERNS) {
    if (pattern.test(message)) return candidate;
  }
  return undefined;
}

/**
 * Classifies a failure from an OWS access layer as a keystore error.
 *
 * A `WALLET_NOT_FOUND` becomes the familiar
 * {@link import("@algorandfoundation/keystore-core").KeyNotFoundError} so
 * callers can treat an OWS-backed keystore exactly like any other; every other
 * failure becomes an {@link OwsError} that keeps the canonical code. The
 * original error is always preserved as `cause` — denials are never softened.
 *
 * @param error - The failure raised by the access layer.
 * @param keyId - The keystore key id the operation was about, when known.
 * @returns The keystore-shaped error to throw.
 *
 * @example
 * ```typescript
 * try {
 *   await binding.signMessage(request);
 * } catch (error) {
 *   throw toKeyStoreError(error, id);
 * }
 * ```
 */
export function toKeyStoreError(error: unknown, keyId?: string): Error {
  if (error instanceof KeyStoreError) return error;
  const cause = error instanceof Error ? error : new Error(String(error ?? "unknown OWS failure"));
  const code = owsErrorCode(error);
  if (code === "WALLET_NOT_FOUND" && keyId !== undefined) {
    return new KeyNotFoundError(keyId, cause);
  }
  return new OwsError(code ?? "OWS_ERROR", cause.message, cause);
}
