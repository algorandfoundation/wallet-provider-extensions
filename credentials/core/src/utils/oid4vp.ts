import { decodeJwt, signCompactJwt } from "./jwt.ts";
import type { JwsSigner } from "./signer.ts";

/**
 * Parsed OID4VP authorization request as surfaced to the wallet.
 *
 * Either the request parameters are inlined in the deep link (simple
 * profile) or the verifier passes a JAR `request` / `request_uri` that
 * must be dereferenced and JWT-decoded. The intermezzo verifier emits
 * the authorization request via Credo's `/oid4vp/*` routes.
 */
export interface AuthorizationRequest {
  client_id?: string;
  client_id_scheme?: string;
  response_type?: string;
  response_mode?: string;
  response_uri?: string;
  redirect_uri?: string;
  nonce?: string;
  state?: string;
  presentation_definition?: Record<string, unknown>;
  presentation_definition_uri?: string;
  dcql_query?: Record<string, unknown>;
  client_metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export type ParsedAuthorizationRequest =
  | { kind: "value"; request: AuthorizationRequest }
  | { kind: "jar"; jwt: string; request: AuthorizationRequest }
  | { kind: "reference"; uri: string };

/**
 * Parses an OID4VP authorization request URL. Handles three shapes:
 *
 * 1. Inlined parameters (`openid4vp://?response_type=...&...`).
 * 2. JAR-by-value (`?request=<signed-JWT>`) — the JWT payload is
 *    returned alongside the raw JWT (signature verification is the
 *    relying-party's job).
 * 3. JAR-by-reference (`?request_uri=<URL>`) — the caller is
 *    expected to GET the URI and re-parse the resulting JWT with
 *    {@link parseAuthorizationRequestJwt}.
 */
export function parseAuthorizationRequestUrl(url: string): ParsedAuthorizationRequest {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    throw new Error("Authorization request URL has no query string");
  }
  const params = new URLSearchParams(url.slice(queryStart + 1));

  const requestJwt = params.get("request");
  if (requestJwt) {
    return { kind: "jar", jwt: requestJwt, request: parseAuthorizationRequestJwt(requestJwt) };
  }
  const requestUri = params.get("request_uri");
  if (requestUri) {
    return { kind: "reference", uri: requestUri };
  }

  const request: AuthorizationRequest = {};
  for (const [k, v] of params.entries()) {
    if (k === "presentation_definition" || k === "dcql_query" || k === "client_metadata") {
      try {
        (request as Record<string, unknown>)[k] = JSON.parse(v);
        continue;
      } catch {
        // fall through, keep as string
      }
    }
    (request as Record<string, unknown>)[k] = v;
  }
  return { kind: "value", request };
}

/**
 * Decodes the payload of a JAR-style authorization request JWT.
 * Signature verification is deliberately out of scope here — the
 * wallet UI just needs the claim set to render consent.
 */
export function parseAuthorizationRequestJwt(jwt: string): AuthorizationRequest {
  return decodeJwt<AuthorizationRequest>(jwt).payload;
}

/**
 * Builds an OID4VP VP token JWT (`vp_token`) bound to the verifier's
 * `nonce` and `client_id` ("audience"). The contained `vp` claim
 * references the SD-JWT VC presentation (or other format-specific
 * proof) by-value in `verifiableCredential`.
 *
 * This is the body the wallet POSTs to the verifier's `response_uri`.
 */
export async function buildVpTokenJwt(params: {
  signer: JwsSigner;
  /** Verifier `client_id` → JWT `aud`. */
  audience: string;
  /** Verifier nonce echoed back to bind the VP. */
  nonce: string;
  /** Holder identifier (typically the wallet's `did:key`). */
  holder: string;
  /** Credential(s) presented inside the VP, format-specific encoding. */
  verifiableCredential: string[];
  /** Optional extra `vp` claim fields. */
  vpExtras?: Record<string, unknown>;
  issuedAt?: number;
}): Promise<string> {
  const iat = params.issuedAt ?? Math.floor(Date.now() / 1000);
  const payload = {
    iss: params.holder,
    sub: params.holder,
    aud: params.audience,
    nonce: params.nonce,
    iat,
    nbf: iat,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: params.holder,
      verifiableCredential: params.verifiableCredential,
      ...params.vpExtras,
    },
  };
  return signCompactJwt({ typ: "JWT" }, payload, params.signer);
}
