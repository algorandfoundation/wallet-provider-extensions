/**
 * Platform contract for the W3C Digital Credentials API.
 *
 * The Digital Credentials API (`navigator.credentials.get({ digital: { requests } })`
 * in browsers, Credential Manager on Android) lets a verifier request a
 * credential presentation through the platform, and lets wallets register as
 * credential providers. This module defines the minimal seam the credentials
 * domain exposes so per-platform implementations can slot in behind
 * `provider.credential.digital` without changing application code.
 *
 * All shapes mirror the W3C Digital Credentials API draft and are marked
 * `@experimental` — the spec is still in flux, so the surface is kept to the
 * smallest useful contract (`isSupported` / `get` / `create` + a typed error).
 *
 * @see https://www.w3.org/TR/digital-credentials/
 */

/**
 * A single protocol-specific request entry, mirroring the W3C
 * `DigitalCredentialGetRequest` / `DigitalCredentialCreateRequest` dictionaries.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export interface DigitalCredentialRequest {
  /**
   * Exchange protocol identifier (e.g. `openid4vp-v1-unsigned`,
   * `openid4vp-v1-signed`, `openid4vci`) from the Digital Credentials
   * protocol registry.
   */
  protocol: string;
  /** Protocol-specific request payload (e.g. an OpenID4VP authorization request). */
  data: unknown;
}

/**
 * Result of a Digital Credentials `get`/`create` call, mirroring the W3C
 * `DigitalCredential` interface.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export interface DigitalCredentialGetResponse {
  /** The protocol of the request entry the user agent fulfilled. */
  protocol: string;
  /** Protocol-specific response payload (e.g. an OpenID4VP authorization response). */
  data: unknown;
}

/**
 * The per-platform Digital Credentials implementation surface.
 *
 * Platform packages (`@algorandfoundation/credentials-web`,
 * `@algorandfoundation/react-native-credentials`) provide an implementation
 * and attach it at `provider.credential.digital`. Implementations must be
 * explicit about missing support: `isSupported()` returns `false` and
 * `get`/`create` reject with {@link DigitalCredentialsUnsupportedError} —
 * never a silent no-op.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export interface DigitalCredentialsPlatform {
  /**
   * Feature-detects the underlying platform API so applications can branch
   * without try/catch.
   */
  isSupported(): boolean;
  /**
   * Requests a credential presentation through the platform, mirroring
   * `navigator.credentials.get({ digital: { requests }, signal })`.
   *
   * @throws {@link DigitalCredentialsUnsupportedError} when the platform API
   *   is unavailable.
   */
  get(req: {
    requests: DigitalCredentialRequest[];
    signal?: AbortSignal;
  }): Promise<DigitalCredentialGetResponse>;
  /**
   * Requests credential issuance through the platform, mirroring
   * `navigator.credentials.create({ digital: { requests }, signal })`.
   *
   * @throws {@link DigitalCredentialsUnsupportedError} when the platform API
   *   is unavailable.
   */
  create(req: {
    requests: DigitalCredentialRequest[];
    signal?: AbortSignal;
  }): Promise<DigitalCredentialGetResponse>;
}

/**
 * Error rejected by {@link DigitalCredentialsPlatform} implementations when
 * the underlying platform API is not available.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export class DigitalCredentialsUnsupportedError extends Error {
  /** The platform that rejected the call (e.g. `web`, `react-native`, `node`). */
  readonly platform: string;
  /** Human-readable explanation of why the platform API is unavailable. */
  readonly reason: string;

  constructor(platform: string, reason: string) {
    super(`Digital Credentials API is not supported on ${platform}: ${reason}`);
    this.name = "DigitalCredentialsUnsupportedError";
    this.platform = platform;
    this.reason = reason;
  }
}
