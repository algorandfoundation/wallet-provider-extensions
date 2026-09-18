/**
 * The assertion-options seam of the Liquid Auth protocol.
 *
 * {@link fetchAssertionOptions} mirrors `assertion.fetch`'s `postOptions`
 * of `@algorandfoundation/liquid-client` (`POST
 * ${origin}/assertion/request/${credId}` with a JSON content type and no
 * body) and normalizes the returned
 * `PublicKeyCredentialRequestOptionsJSON` into a small shape a passkey
 * store can reconcile against (see `@algorandfoundation/passkeys-core`).
 */

import { LiquidAuthError } from "./errors.ts";

/**
 * Server-provided WebAuthn request options, normalized for
 * reconciliation: the `rpId` in scope, the `allowCredentials` ids as
 * base64url strings, plus the raw payload for anything else.
 */
export interface LiquidAssertionOptions {
  /** The relying party identifier the options are scoped to. */
  rpId?: string;
  /** The credential descriptors the server will accept (ids base64url). */
  allowCredentials?: { id: string; type?: string }[];
  /** The raw `PublicKeyCredentialRequestOptionsJSON` payload. */
  raw: Record<string, unknown>;
}

/**
 * Fetches WebAuthn assertion request options from a liquid-auth
 * signaling service.
 *
 * Sends the exact request `@algorandfoundation/liquid-client`'s
 * `assertion.fetch` sends: `POST ${url}/assertion/request/${credentialId}`
 * with a `Content-Type: application/json` header and no body, accepting
 * `200`/`201` responses.
 *
 * @param params - The signaling origin, the credential id to request
 * options for, and an optional `fetch` override (for tests / custom
 * transports).
 * @returns The normalized {@link LiquidAssertionOptions}.
 * @throws {@link LiquidAuthError} with code `assertion_request_failed`
 * on a non-OK response.
 */
export async function fetchAssertionOptions(params: {
  url: string;
  credentialId: string;
  fetchFn?: typeof fetch;
}): Promise<LiquidAssertionOptions> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(`${params.url}/assertion/request/${params.credentialId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!response.ok || (response.status !== 200 && response.status !== 201)) {
    throw new LiquidAuthError(
      "assertion_request_failed",
      `assertion options request failed with status ${response.status}`,
    );
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const options: LiquidAssertionOptions = { raw };
  if (typeof raw.rpId === "string") {
    options.rpId = raw.rpId;
  }
  if (Array.isArray(raw.allowCredentials)) {
    options.allowCredentials = raw.allowCredentials
      .filter(
        (entry): entry is { id: string; type?: string } =>
          !!entry && typeof (entry as { id?: unknown }).id === "string",
      )
      .map((entry) => ({
        id: entry.id,
        ...(typeof entry.type === "string" ? { type: entry.type } : {}),
      }));
  }
  return options;
}
