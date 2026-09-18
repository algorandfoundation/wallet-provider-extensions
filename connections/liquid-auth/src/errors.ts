/**
 * Error raised by the Liquid Auth protocol, carrying a stable machine
 * code alongside the human-readable message.
 *
 * Well-known codes:
 * - `invalid_uri`: a `liquid://` URI failed to parse.
 * - `invalid_session`: a `resume()` was attempted with a session
 *   missing its `id`/`origin`.
 * - `invalid_address`: a value could not be normalized to a canonical
 *   Algorand address (see `toAlgorandAddress`).
 * - `webauthn_unavailable`: the host has no WebAuthn implementation
 *   (`navigator.credentials`) and none was injected.
 * - `auth_signer_missing`: the responder needs the liquid-extension
 *   `authSigner` seam but none was configured.
 * - `establish_failed`: the signaling/peering handshake failed.
 * - `assertion_request_failed`: the assertion-options request to the
 *   signaling service returned a non-OK response.
 * - `aborted`: the caller aborted the operation via an `AbortSignal`.
 */
export class LiquidAuthError extends Error {
  /** Stable machine-readable error code (e.g. `invalid_uri`). */
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "LiquidAuthError";
    this.code = code;
  }
}
