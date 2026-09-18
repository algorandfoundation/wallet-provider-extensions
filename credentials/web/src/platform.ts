import {
  DigitalCredentialsUnsupportedError,
  type DigitalCredentialGetResponse,
  type DigitalCredentialRequest,
  type DigitalCredentialsPlatform,
} from "@algorandfoundation/credentials-core";

const REASON =
  "this browser does not implement the Digital Credentials API " +
  "(no DigitalCredential interface / navigator.credentials support)";

/**
 * The subset of the browser `CredentialsContainer` surface used by the
 * Digital Credentials API. Typed structurally because the `digital` member
 * is not part of the standard DOM lib yet.
 */
interface DigitalCredentialsContainer {
  get(options: {
    digital: { requests: DigitalCredentialRequest[] };
    signal?: AbortSignal;
  }): Promise<unknown>;
  create(options: {
    digital: { requests: DigitalCredentialRequest[] };
    signal?: AbortSignal;
  }): Promise<unknown>;
}

/**
 * Feature-detects the browser Digital Credentials API and returns the
 * credentials container when available.
 *
 * Detection follows the W3C draft: user agents that implement the API expose
 * the `DigitalCredential` interface object (this is the check
 * digitalcredentials.dev recommends), alongside `navigator.credentials`.
 */
function resolveContainer(): DigitalCredentialsContainer | undefined {
  const g = globalThis as {
    DigitalCredential?: unknown;
    navigator?: { credentials?: Partial<DigitalCredentialsContainer> };
  };
  if (typeof g.DigitalCredential !== "function") return undefined;
  const credentials = g.navigator?.credentials;
  if (typeof credentials?.get !== "function" || typeof credentials?.create !== "function") {
    return undefined;
  }
  return credentials as DigitalCredentialsContainer;
}

/**
 * Normalizes the `DigitalCredential` returned by the user agent into the
 * platform-neutral {@link DigitalCredentialGetResponse} shape.
 */
function toResponse(result: unknown, operation: "get" | "create"): DigitalCredentialGetResponse {
  const credential = result as { protocol?: unknown; data?: unknown } | null | undefined;
  if (!credential || typeof credential.protocol !== "string") {
    throw new Error(
      `webDigitalCredentials.${operation}: the user agent did not return a DigitalCredential`,
    );
  }
  return { protocol: credential.protocol, data: credential.data };
}

/**
 * Browser implementation of the {@link DigitalCredentialsPlatform} contract.
 *
 * Feature-detects the W3C Digital Credentials API (the `DigitalCredential`
 * interface object plus `navigator.credentials`) and forwards the W3C-shaped
 * requests to the user agent:
 *
 * - {@link DigitalCredentialsPlatform.get | `get`}: credential
 *   **presentation** via `navigator.credentials.get({ digital: { requests }, signal })`.
 *   Shipping in Chrome/Edge 141+ (desktop + Android) and Safari on
 *   iOS/macOS 26.
 * - {@link DigitalCredentialsPlatform.create | `create`}: credential
 *   **issuance** via `navigator.credentials.create(...)`. Still behind flags
 *   in most user agents; when the browser exposes the API but has issuance
 *   disabled, the user agent's own rejection is propagated.
 *
 * On browsers without the API, `isSupported()` returns `false` and both
 * calls reject with {@link DigitalCredentialsUnsupportedError}, never a
 * silent no-op.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 *
 * @example
 * ```typescript
 * if (webDigitalCredentials.isSupported()) {
 *   const response = await webDigitalCredentials.get({
 *     requests: [{ protocol: "openid4vp-v1-unsigned", data: authorizationRequest }],
 *   });
 * }
 * ```
 */
export const webDigitalCredentials: DigitalCredentialsPlatform = {
  isSupported(): boolean {
    return resolveContainer() !== undefined;
  },
  async get(req): Promise<DigitalCredentialGetResponse> {
    const container = resolveContainer();
    if (!container) {
      throw new DigitalCredentialsUnsupportedError("web", REASON);
    }
    const result = await container.get({
      digital: { requests: req.requests },
      signal: req.signal,
    });
    return toResponse(result, "get");
  },
  async create(req): Promise<DigitalCredentialGetResponse> {
    const container = resolveContainer();
    if (!container) {
      throw new DigitalCredentialsUnsupportedError("web", REASON);
    }
    const result = await container.create({
      digital: { requests: req.requests },
      signal: req.signal,
    });
    return toResponse(result, "create");
  },
};
