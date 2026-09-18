/**
 * The wire types the Digital Credentials native module (shipped by this
 * package under `android/` and `ios/`, configured through
 * `expo-module.config.json`) exchanges with JavaScript. This file contains
 * types only (no executable code), so it is safe to import from any runtime.
 */

/**
 * A claim entry in the native registration shape, consumed by the platform
 * matcher to pre-filter and render credentials in the picker UI.
 *
 * @example
 * ```typescript
 * const claim: RegisteredClaim = { path: ["given_name"], displayName: "Given name" };
 * ```
 */
export type RegisteredClaim = {
  /** Claim path within the credential (e.g. `["address", "city"]`). */
  path: string[];
  /** The claim value, when it should be matchable. */
  value?: unknown;
  /** Label shown in the picker. */
  displayName: string;
  /** Value rendering shown in the picker. */
  displayValue?: string;
  /** Whether the claim is selectively disclosable. Defaults to `true`. */
  selectivelyDisclosable?: boolean;
};

/**
 * The native registration shape for one credential (SD-JWT VC only for
 * now), as the platform credential registry expects it.
 *
 * @example
 * ```typescript
 * const entry: RegisteredSdJwtCredential = {
 *   id: "cred-1",
 *   format: "dc+sd-jwt",
 *   vct: "https://credentials.example/badge",
 *   title: "Membership badge",
 *   claims: [{ path: ["given_name"], displayName: "Given name" }],
 * };
 * ```
 */
export type RegisteredSdJwtCredential = {
  /** Stable unique id, <= 64 chars (enforced by the platform registry). */
  id: string;
  /** Credential format; only `dc+sd-jwt` is registrable today. */
  format: "dc+sd-jwt";
  /** SD-JWT VC verifiable credential type (`vct`) the matcher filters on. */
  vct: string;
  /** Primary label shown in the platform chooser. */
  title: string;
  /** Secondary label shown in the platform chooser. */
  subtitle?: string;
  /**
   * Optional PNG, base64 (no `data:` prefix); native falls back to a
   * generated placeholder.
   */
  iconBase64?: string;
  /** Claims consumed by the platform matcher. */
  claims: RegisteredClaim[];
};

/**
 * The event payload the native module emits when the platform routes a
 * Digital Credentials presentation request to the wallet.
 *
 * @example
 * ```typescript
 * module.addListener("onPresentationRequest", (event: PresentationRequestEvent) => {
 *   module.completePresentationRequest(event.requestId, responseJson);
 * });
 * ```
 */
export type PresentationRequestEvent = {
  /** Native correlation id used to complete or abort the platform flow. */
  requestId: string;
  /** Exchange protocol of the routed request (e.g. `openid4vp-v1-unsigned`). */
  protocol: string;
  /** The protocol-specific request payload, JSON-serialized by the platform. */
  dataJson: string;
  /** The verifier origin, when derivable. */
  origin?: string;
  /** The registered credential id the user picked in the chooser. */
  selectedEntryId?: string;
};

/** The event map of the Digital Credentials native module. *
 * @example
 * ```typescript
 * const module = requireNativeModule<ReactNativeDigitalCredentialsModuleEvents>("ReactNativeDigitalCredentials");
 * ```
 */
export type ReactNativeDigitalCredentialsModuleEvents = {
  onPresentationRequest: (event: PresentationRequestEvent) => void;
};
