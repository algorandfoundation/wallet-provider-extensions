/**
 * Platform contract for the W3C Digital Credentials API.
 *
 * The Digital Credentials API (`navigator.credentials.get({ digital: { requests } })`
 * in browsers, Credential Manager on Android) lets a verifier request a
 * credential presentation through the platform, and lets wallets register as
 * credential providers. This module defines the minimal seams the credentials
 * domain exposes for **both sides** of the API:
 *
 * - {@link DigitalCredentialsPlatform}: the *requester* side (acting as a
 *   verifier/issuer through the user agent), attached per platform at
 *   `provider.credential.digital`.
 * - {@link DigitalCredentialsProvider}: the *wallet/holder* side
 *   (registering credentials with the OS registry and answering routed
 *   presentation requests). Implemented for React Native on Android
 *   (`@algorandfoundation/react-native-credentials`, backed by the
 *   Credential Manager expo module that package bundles); the remaining
 *   native implementations land later.
 *
 * All shapes mirror the W3C Digital Credentials API draft and are marked
 * `@experimental`; the spec is still in flux, so the surface is kept to the
 * smallest useful contract plus a typed error.
 *
 * @see https://www.w3.org/TR/digital-credentials/
 */

/**
 * A single protocol-specific request entry, mirroring the W3C
 * `DigitalCredentialGetRequest` / `DigitalCredentialCreateRequest` dictionaries.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * const request: DigitalCredentialRequest = {
 *   protocol: "openid4vp-v1-unsigned",
 *   data: authorizationRequest,
 * };
 * ```
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
 *
 * @example
 * ```typescript
 * const response: DigitalCredentialGetResponse = await provider.credential.digital.get({ requests });
 * if (response.protocol === "openid4vp-v1-unsigned") verify(response.data);
 * ```
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
 * `@algorandfoundation/react-native-credentials`,
 * `@algorandfoundation/credentials-node`) provide an implementation
 * and attach it at `provider.credential.digital`. Implementations must be
 * explicit about missing support: `isSupported()` returns `false` and
 * `get`/`create` reject with {@link DigitalCredentialsUnsupportedError},
 * never a silent no-op.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * const digital: DigitalCredentialsPlatform = provider.credential.digital;
 * if (digital.isSupported()) {
 *   const response = await digital.get({ requests: [request] });
 * }
 * ```
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
 * A credential the wallet advertises to the platform's credential registry
 * so it can be surfaced in the OS/browser credential chooser.
 *
 * On Android this maps to a Credential Manager registry entry
 * (`androidx.credentials.registry`), on iOS 26+ to an
 * `IdentityDocumentServices` document. The `metadata` payload is
 * protocol-specific and consumed by the platform matcher that pre-filters
 * credentials in the picker UI.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * const entry: DigitalCredentialProviderEntry = {
 *   id: credential.id,
 *   protocols: ["openid4vp-v1-unsigned"],
 *   display: { title: credential.name, subtitle: credential.identityAddress },
 *   metadata: { vct: "https://credentials.example/badge", claims: [{ path: ["given_name"] }] },
 * };
 * ```
 */
export interface DigitalCredentialProviderEntry {
  /**
   * Stable identifier for the credential, echoed back as
   * {@link DigitalCredentialProviderRequest.selectedCredentialId} when the
   * user picks it. Typically the credential store's credential `id`.
   */
  id: string;
  /**
   * Exchange protocols this credential can be presented over (e.g.
   * `openid4vp-v1-unsigned`, `org-iso-mdoc`), from the Digital Credentials
   * protocol registry.
   */
  protocols: string[];
  /** Display hints for the platform credential chooser. */
  display?: {
    /** Primary label shown in the chooser (e.g. the credential name). */
    title: string;
    /** Secondary label (e.g. the issuer or holder identity). */
    subtitle?: string;
  };
  /**
   * Protocol-specific matching metadata (e.g. the claims/doctype the
   * credential can satisfy) consumed by the platform matcher.
   */
  metadata?: Record<string, unknown>;
}

/**
 * An incoming Digital Credentials presentation request routed to the wallet
 * by the platform after the user selected one of the registered credentials.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * digitalProvider.setRequestHandler(async (request: DigitalCredentialProviderRequest) => {
 *   const credential = await store.getCredential(request.selectedCredentialId!);
 *   return { protocol: request.protocol, data: await buildResponse(credential, request.data) };
 * });
 * ```
 */
export interface DigitalCredentialProviderRequest {
  /** Exchange protocol of the request entry the platform routed to us. */
  protocol: string;
  /**
   * Protocol-specific request payload (e.g. an OpenID4VP authorization
   * request), exactly as sent by the verifier.
   */
  data: unknown;
  /** The requesting origin, when the platform makes it available. */
  origin?: string;
  /**
   * The {@link DigitalCredentialProviderEntry.id} of the credential the user
   * selected in the platform chooser, when available.
   */
  selectedCredentialId?: string;
}

/**
 * Handler invoked by the platform bridge with an incoming presentation
 * request. The wallet builds the protocol response (e.g. an OpenID4VP
 * authorization response over the selected credential) and returns it to be
 * handed back to the calling verifier. Rejecting aborts the platform flow.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * const handler: DigitalCredentialRequestHandler = async (request) => ({
 *   protocol: request.protocol,
 *   data: await buildOpenId4VpResponse(request),
 * });
 * ```
 */
export type DigitalCredentialRequestHandler = (
  request: DigitalCredentialProviderRequest,
) => Promise<DigitalCredentialGetResponse>;

/**
 * The wallet-side (holder/provider) Digital Credentials surface: registering
 * the wallet's credentials with the OS credential registry and answering the
 * presentation requests the platform routes back.
 *
 * There is no web API for this side; it is inherently native:
 *
 * - **Android**: Credential Manager registry
 *   (`RegistryManager.registerCredentials(...)`) plus a provider activity
 *   handling the `GET_CREDENTIAL` intent.
 * - **iOS 26+**: an `IdentityDocumentServices` app extension (currently
 *   mdoc / ISO 18013-7 Annex C only).
 *
 * The Android implementation ships today: `react-native-credentials`
 * attaches it at `provider.credential.digitalProvider`, backed by the
 * Digital Credentials native module bundled with that package (mirroring
 * the passkey-autofill work) through an injectable seam. iOS support
 * lands later. Implementations must be explicit about missing
 * support: `isSupported()` returns `false` and the register/unregister calls
 * reject with {@link DigitalCredentialsUnsupportedError}, never a silent
 * no-op.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * const digital: DigitalCredentialsProvider = provider.credential.digitalProvider;
 * if (digital.isSupported()) {
 *   await digital.registerCredentials(entries);
 *   digital.setRequestHandler(handler);
 * }
 * ```
 */
export interface DigitalCredentialsProvider {
  /**
   * Feature-detects the platform credential-provider registry so
   * applications can branch without try/catch.
   */
  isSupported(): boolean;
  /**
   * Publishes (or replaces) the wallet's credential entries in the platform
   * registry so they appear in the OS/browser credential chooser. Callers
   * typically re-register on every credential store change.
   *
   * @throws {@link DigitalCredentialsUnsupportedError} when the platform
   *   registry is unavailable.
   */
  registerCredentials(entries: DigitalCredentialProviderEntry[]): Promise<void>;
  /**
   * Removes all of the wallet's entries from the platform registry.
   *
   * @throws {@link DigitalCredentialsUnsupportedError} when the platform
   *   registry is unavailable.
   */
  unregisterCredentials(): Promise<void>;
  /**
   * Installs the handler invoked when the platform routes a presentation
   * request to the wallet. Replaces any previously installed handler.
   */
  setRequestHandler(handler: DigitalCredentialRequestHandler): void;
}

/**
 * Error rejected by {@link DigitalCredentialsPlatform} and
 * {@link DigitalCredentialsProvider} implementations when the underlying
 * platform API is not available.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.credential.digital.get({ requests });
 * } catch (error) {
 *   if (error instanceof DigitalCredentialsUnsupportedError) fallbackToQrFlow(error.reason);
 * }
 * ```
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
