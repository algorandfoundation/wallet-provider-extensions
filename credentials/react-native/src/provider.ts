/**
 * The binding between the {@link DigitalCredentialsProvider} contract and
 * the Digital Credentials expo native module this package ships (see
 * `./digital/`).
 *
 * The native module is **injected** through the structural
 * {@link DigitalCredentialsModuleLike} seam (no compile-time dependency on
 * react-native), so this package builds and tests without native code,
 * exactly like the passkeys package binds `react-native-passkey-autofill`.
 * {@link toRegisteredCredential} maps a core
 * {@link DigitalCredentialProviderEntry} to the native registration shape
 * (SD-JWT VC only for now) and is exported for unit testing.
 */

import {
  DigitalCredentialsUnsupportedError,
  type DigitalCredentialProviderEntry,
  type DigitalCredentialProviderRequest,
  type DigitalCredentialRequestHandler,
  type DigitalCredentialsProvider,
} from "@algorandfoundation/credentials-core";

/**
 * The event payload the native module emits when the platform routes a
 * Digital Credentials presentation request to the wallet.
 *
 * @example
 * ```typescript
 * module.addListener("onPresentationRequest", (event: DigitalCredentialsPresentationRequestEvent) => {
 *   console.log(event.protocol, JSON.parse(event.dataJson));
 * });
 * ```
 */
export interface DigitalCredentialsPresentationRequestEvent {
  /** Correlation id used to complete or abort the platform flow. */
  requestId: string;
  /** Exchange protocol of the routed request entry. */
  protocol: string;
  /** Protocol-specific request payload, JSON-serialized by the platform. */
  dataJson: string;
  /** The requesting origin, when the platform makes it available. */
  origin?: string;
  /** The registered entry id the user picked in the chooser, when available. */
  selectedEntryId?: string;
}

/**
 * The subset of the bundled native module's surface this binding consumes
 * (structural, so tests inject doubles).
 *
 * @example
 * ```typescript
 * const fake: DigitalCredentialsModuleLike = {
 *   isSupported: () => true,
 *   registerCredentials: async () => {},
 *   unregisterCredentials: async () => {},
 *   completePresentationRequest: () => {},
 *   abortPresentationRequest: () => {},
 *   addListener: () => ({ remove() {} }),
 * };
 * const digital = nativeDigitalCredentialsProvider(fake);
 * ```
 */
export interface DigitalCredentialsModuleLike {
  /** Whether the platform credential-provider registry is available. */
  isSupported(): boolean;
  /** Publishes (or replaces) the JSON-serialized registration entries. */
  registerCredentials(entriesJson: string): Promise<void>;
  /** Removes every entry this app registered. */
  unregisterCredentials(): Promise<void>;
  /** Hands the JSON-serialized protocol response back to the platform. */
  completePresentationRequest(requestId: string, responseJson: string): void;
  /** Aborts the platform flow with a human-readable message. */
  abortPresentationRequest(requestId: string, message: string): void;
  /** Subscribes to routed presentation requests. */
  addListener(
    eventName: "onPresentationRequest",
    listener: (event: DigitalCredentialsPresentationRequestEvent) => void,
  ): { remove(): void };
}

/**
 * A claim entry in the native registration shape, consumed by the platform
 * matcher to pre-filter and render credentials in the picker UI.
 *
 * @example
 * ```typescript
 * const claim: RegisteredDigitalCredentialClaim = {
 *   path: ["given_name"],
 *   displayName: "Given name",
 *   selectivelyDisclosable: true,
 * };
 * ```
 */
export interface RegisteredDigitalCredentialClaim {
  /** Claim path within the credential (e.g. `["address", "city"]`). */
  path: string[];
  /** The claim value, when it should be matchable. */
  value?: unknown;
  /** Label shown in the picker; defaults to the joined path. */
  displayName?: string;
  /** Value rendering shown in the picker. */
  displayValue?: string;
  /** Whether the claim is selectively disclosable. */
  selectivelyDisclosable?: boolean;
}

/**
 * The native registration shape for one credential, as the bundled native
 * module expects it (SD-JWT VC only for now).
 *
 * @example
 * ```typescript
 * const registered: RegisteredDigitalCredential = {
 *   id: "cred-1",
 *   format: "dc+sd-jwt",
 *   vct: "https://credentials.example/badge",
 *   title: "Membership badge",
 *   claims: [{ path: ["given_name"], displayName: "Given name" }],
 * };
 * ```
 */
export interface RegisteredDigitalCredential {
  /** Stable identifier, echoed back as the selected entry id. */
  id: string;
  /** Credential format; only `dc+sd-jwt` is registrable today. */
  format: "dc+sd-jwt";
  /** The SD-JWT VC type (`vct`) the platform matcher filters on. */
  vct: string;
  /** Primary label shown in the platform chooser. */
  title: string;
  /** Secondary label shown in the platform chooser. */
  subtitle?: string;
  /** Claims consumed by the platform matcher. */
  claims: RegisteredDigitalCredentialClaim[];
}

/**
 * Maps a core {@link DigitalCredentialProviderEntry} to the native
 * registration shape.
 *
 * Only SD-JWT VC entries are registrable today: `vct` comes from
 * `entry.metadata.vct` and the matcher claims from `entry.metadata.claims`
 * (each claim's `displayName` defaults to its joined path). `title` falls
 * back to the entry id when no display hint is provided. Returns
 * `undefined` when `metadata.vct` is missing; callers skip those entries.
 *
 * @param entry - The core provider entry.
 * @returns The native registration shape, or `undefined` when not registrable.
 *
 * @example
 * ```typescript
 * const registered = toRegisteredCredential({
 *   id: credential.id,
 *   protocols: ["openid4vp-v1-unsigned"],
 *   display: { title: credential.name },
 *   metadata: { vct: "https://credentials.example/badge", claims: [] },
 * });
 * ```
 */
export function toRegisteredCredential(
  entry: DigitalCredentialProviderEntry,
): RegisteredDigitalCredential | undefined {
  const vct = entry.metadata?.vct;
  if (typeof vct !== "string") return undefined;
  const rawClaims = entry.metadata?.claims;
  const claims: RegisteredDigitalCredentialClaim[] = (
    Array.isArray(rawClaims) ? (rawClaims as RegisteredDigitalCredentialClaim[]) : []
  ).map((claim) => ({
    ...claim,
    displayName: claim.displayName ?? claim.path.join("."),
  }));
  const registered: RegisteredDigitalCredential = {
    id: entry.id,
    format: "dc+sd-jwt",
    vct,
    title: entry.display?.title ?? entry.id,
    claims,
  };
  if (entry.display?.subtitle !== undefined) registered.subtitle = entry.display.subtitle;
  return registered;
}

/**
 * Builds the {@link DigitalCredentialsProvider} over the injected native
 * module: `isSupported`/`unregisterCredentials` pass through,
 * `registerCredentials` serializes the {@link toRegisteredCredential}
 * mapping (skipping non-SD-JWT-VC entries), and `setRequestHandler`
 * lazily subscribes once to `onPresentationRequest`: each event is parsed
 * into a {@link DigitalCredentialProviderRequest} (raw string when the
 * payload is not JSON), routed to the current handler, and its resolution
 * completes (or its rejection aborts) the platform flow.
 *
 * @param module - The injected {@link DigitalCredentialsModuleLike}.
 * @returns The React Native {@link DigitalCredentialsProvider}.
 *
 * @example
 * ```typescript
 * const module = defaultDigitalCredentialsModule();
 * const provider = module
 *   ? nativeDigitalCredentialsProvider(module)
 *   : unsupportedDigitalCredentialsProvider("the native module is unavailable");
 * ```
 */
export function nativeDigitalCredentialsProvider(
  module: DigitalCredentialsModuleLike,
): DigitalCredentialsProvider {
  let handler: DigitalCredentialRequestHandler | undefined;
  let subscription: { remove(): void } | undefined;

  const onPresentationRequest = (event: DigitalCredentialsPresentationRequestEvent): void => {
    const current = handler;
    if (!current) {
      module.abortPresentationRequest(
        event.requestId,
        "no Digital Credentials request handler is installed; call setRequestHandler(...) first",
      );
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(event.dataJson);
    } catch {
      // Not JSON; pass the raw payload through untouched.
      data = event.dataJson;
    }
    const request: DigitalCredentialProviderRequest = { protocol: event.protocol, data };
    if (event.origin !== undefined) request.origin = event.origin;
    if (event.selectedEntryId !== undefined) request.selectedCredentialId = event.selectedEntryId;
    current(request).then(
      (response) => {
        module.completePresentationRequest(
          event.requestId,
          JSON.stringify({ protocol: response.protocol, data: response.data }),
        );
      },
      (error: unknown) => {
        module.abortPresentationRequest(
          event.requestId,
          error instanceof Error ? error.message : String(error),
        );
      },
    );
  };

  return {
    isSupported(): boolean {
      return module.isSupported();
    },
    async registerCredentials(entries: DigitalCredentialProviderEntry[]): Promise<void> {
      const registered = entries
        .map(toRegisteredCredential)
        .filter((entry): entry is RegisteredDigitalCredential => entry !== undefined);
      await module.registerCredentials(JSON.stringify(registered));
    },
    async unregisterCredentials(): Promise<void> {
      await module.unregisterCredentials();
    },
    setRequestHandler(nextHandler: DigitalCredentialRequestHandler): void {
      handler = nextHandler;
      // Subscribe lazily and only once; re-setting just swaps the handler.
      subscription ??= module.addListener("onPresentationRequest", onPresentationRequest);
    },
  };
}

/**
 * Builds an **explicit `unsupported`** {@link DigitalCredentialsProvider}:
 * `isSupported()` returns `false` and register/unregister reject with
 * {@link DigitalCredentialsUnsupportedError}, never a silent no-op.
 * `setRequestHandler` is a documented no-op (the contract only allows a
 * synchronous `void`, so there is nothing to reject).
 *
 * @param reason - Human-readable explanation of the missing support.
 * @returns The unsupported {@link DigitalCredentialsProvider}.
 *
 * @example
 * ```typescript
 * const digital = unsupportedDigitalCredentialsProvider("iOS registry support has not landed");
 * digital.isSupported(); // false
 * ```
 */
export function unsupportedDigitalCredentialsProvider(reason: string): DigitalCredentialsProvider {
  return {
    isSupported(): boolean {
      return false;
    },
    async registerCredentials(): Promise<void> {
      throw new DigitalCredentialsUnsupportedError("react-native", reason);
    },
    async unregisterCredentials(): Promise<void> {
      throw new DigitalCredentialsUnsupportedError("react-native", reason);
    },
    setRequestHandler(): void {
      // No-op: no platform will ever route a request here. The contract's
      // setRequestHandler is synchronous void, so rejecting is not possible;
      // feature-detect via isSupported() before wiring a handler.
    },
  };
}

// Metro (React Native) transforms this module to CJS, so `require` exists
// at runtime; under Node ESM (tests, tooling) it does not and the lazy
// lookup below degrades to `undefined`.
declare const require: ((id: string) => unknown) | undefined;

/**
 * Lazily resolves the default export of this package's own Digital
 * Credentials native module binding (`./digital/`), when a CJS `require`
 * exists in the host runtime and the expo native module is compiled into
 * the app. Resolves `undefined` otherwise; callers then inject the
 * module explicitly or fall back to the `unsupported` provider.
 *
 * @returns The native module, or `undefined` when unavailable.
 *
 * @example
 * ```typescript
 * const module = defaultDigitalCredentialsModule();
 * const digital = module
 *   ? nativeDigitalCredentialsProvider(module)
 *   : unsupportedDigitalCredentialsProvider("native module unavailable");
 * ```
 */
export function defaultDigitalCredentialsModule(): DigitalCredentialsModuleLike | undefined {
  try {
    if (typeof require !== "function") return undefined;
    // The runtime (post-compile) path: tsc does not rewrite require() targets.
    const resolved = require("./digital/index.js") as { default?: unknown } | undefined;
    const candidate =
      resolved && typeof resolved === "object" && "default" in resolved
        ? resolved.default
        : resolved;
    // Validate by shape: bundler require shims can resolve to anything.
    if (
      candidate &&
      typeof (candidate as DigitalCredentialsModuleLike).registerCredentials === "function"
    ) {
      return candidate as DigitalCredentialsModuleLike;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
