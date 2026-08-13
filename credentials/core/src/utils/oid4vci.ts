import { signCompactJwt } from "./jwt.ts";
import type { JwsSigner, JsonWebKey } from "./signer.ts";

/**
 * Parsed OID4VCI Credential Offer.
 *
 * The wire form is either:
 *
 *   openid-credential-offer://?credential_offer=<URL-encoded JSON>
 *
 * (offer-by-value) or
 *
 *   openid-credential-offer://?credential_offer_uri=<URL>
 *
 * (offer-by-reference — the wallet must GET the URI to retrieve the
 * JSON body).
 */
export interface CredentialOffer {
  credential_issuer: string;
  credential_configuration_ids: string[];
  grants?: {
    authorization_code?: {
      issuer_state?: string;
      authorization_server?: string;
    };
    "urn:ietf:params:oauth:grant-type:pre-authorized_code"?: {
      "pre-authorized_code": string;
      tx_code?: {
        input_mode?: "numeric" | "text";
        length?: number;
        description?: string;
      };
      authorization_server?: string;
    };
  };
}

/**
 * Result of parsing a credential offer URL — either an inlined offer
 * payload, or a reference URI that must be fetched.
 */
export type ParsedCredentialOffer =
  | { kind: "value"; offer: CredentialOffer }
  | { kind: "reference"; uri: string };

/**
 * Parses a credential offer URL (any scheme — `openid-credential-offer://`,
 * `haip://`, custom deep link) into either an inlined offer or a URI
 * the wallet must dereference.
 */
export function parseCredentialOfferUrl(url: string): ParsedCredentialOffer {
  // URL parser is tolerant of custom schemes but doesn't expose query for
  // non-special schemes consistently — fall back to manual parsing.
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    throw new Error("Credential offer URL has no query string");
  }
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const inline = params.get("credential_offer");
  if (inline) {
    return { kind: "value", offer: JSON.parse(inline) as CredentialOffer };
  }
  const ref = params.get("credential_offer_uri");
  if (ref) {
    return { kind: "reference", uri: ref };
  }
  throw new Error("Credential offer URL missing credential_offer / credential_offer_uri");
}

/**
 * Builds the OID4VCI holder proof-of-possession JWT (`proof_type: jwt`)
 * required by the `/credential` token endpoint.
 *
 * The issuer (Credo) validates that the embedded `jwk` matches the
 * `holderDidKey` pinned into the offer.
 */
export async function buildCredentialProofJwt(params: {
  signer: JwsSigner;
  /** Credential issuer URL (`aud`). */
  audience: string;
  /** Nonce returned by the token endpoint (`c_nonce`). */
  nonce: string;
  /** Optional override for the embedded JWK — only used when no `kid` is available. */
  jwk?: JsonWebKey;
  /** Optional override for the embedded `kid` — defaults to `signer.kid`. */
  kid?: string;
  /** Issuer (`iss`) claim — typically the holder did:key. Defaults to the `kid`'s DID part. */
  issuer?: string;
  issuedAt?: number;
}): Promise<{ proof_type: "jwt"; jwt: string }> {
  // OID4VCI §7.2.1.1: the proof JWT header MUST contain exactly one of
  // `kid`, `jwk`, or `x5c`. Prefer `kid` (did:key fragment) when the
  // signer provides one, matching the intermezzo-fresh e2e; otherwise
  // fall back to embedding the `jwk` directly.
  const kid = params.kid ?? params.signer.kid;
  const baseHeader: Record<string, unknown> = {
    typ: "openid4vci-proof+jwt",
    alg: params.signer.alg,
  };
  if (kid) {
    baseHeader.kid = kid;
  } else {
    const jwk = params.jwk ?? params.signer.publicKeyJwk;
    if (!jwk) {
      throw new Error(
        "buildCredentialProofJwt: signer must expose either `kid` or `publicKeyJwk`.",
      );
    }
    baseHeader.jwk = jwk;
  }
  // Strip `kid` off the signer so signCompactJwt doesn't reintroduce it
  // when we deliberately chose the `jwk` route (and vice versa).
  const headerOnlySigner = { ...params.signer, kid: undefined } as JwsSigner;
  const issuer = params.issuer ?? (kid ? kid.split("#")[0] : undefined);
  const payload: Record<string, unknown> = {
    aud: params.audience,
    iat: params.issuedAt ?? Math.floor(Date.now() / 1000),
    nonce: params.nonce,
  };
  if (issuer) payload.iss = issuer;
  const jwt = await signCompactJwt(baseHeader, payload, headerOnlySigner);
  return { proof_type: "jwt", jwt };
}

/** Pre-authorized-code grant URI per OID4VCI / RFC 8628. */
export const PRE_AUTHORIZED_CODE_GRANT =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code" as const;

/**
 * Minimal slice of the
 * `/.well-known/openid-credential-issuer` metadata used by the
 * holder. Servers (Credo) emit far more — we only declare what the
 * redemption flow consumes.
 */
export interface CredentialIssuerMetadata {
  credential_issuer: string;
  credential_endpoint: string;
  token_endpoint?: string;
  authorization_servers?: string[];
  [key: string]: unknown;
}

/** Response of the OID4VCI token endpoint (pre-authorized-code grant). */
export interface OidcTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  c_nonce?: string;
  c_nonce_expires_in?: number;
  [key: string]: unknown;
}

/**
 * Response of `POST {credential_endpoint}`. Credo emits either a
 * single `credential` (string) or an array of `credentials` (each
 * either a compact string or `{ credential: string }`). Holders
 * should normalise via {@link extractIssuedCredential}.
 */
export interface CredentialEndpointResponse {
  credential?: string;
  credentials?: Array<string | { credential: string }>;
  c_nonce?: string;
  c_nonce_expires_in?: number;
  [key: string]: unknown;
}

/** Optional dependency injection for tests / non-fetch environments. */
export interface OidcFetcher {
  fetch?: typeof fetch;
}

const defaultFetch = (impl?: typeof fetch): typeof fetch =>
  impl ?? globalThis.fetch.bind(globalThis);

/**
 * `GET {credential_issuer}/.well-known/openid-credential-issuer` —
 * discovers the issuer's `token_endpoint` / `credential_endpoint`.
 *
 * If the metadata omits `token_endpoint` (some Credo builds), this
 * helper falls back to `<authorization_servers[0] ?? credential_issuer>/token`.
 */
export async function fetchIssuerMetadata(
  credentialIssuer: string,
  options: OidcFetcher = {},
): Promise<CredentialIssuerMetadata> {
  const base = credentialIssuer.replace(/\/+$/u, "");
  const url = `${base}/.well-known/openid-credential-issuer`;
  const response = await defaultFetch(options.fetch)(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`fetchIssuerMetadata: ${url} → ${response.status} ${response.statusText}`);
  }
  const metadata = (await response.json()) as CredentialIssuerMetadata;
  if (!metadata.token_endpoint) {
    const authBase = (
      metadata.authorization_servers?.[0] ??
      metadata.credential_issuer ??
      base
    ).replace(/\/+$/u, "");
    metadata.token_endpoint = `${authBase}/token`;
  }
  return metadata;
}

/**
 * Exchanges a pre-authorized code for an access token + `c_nonce` at
 * the issuer's `token_endpoint`.
 */
export async function exchangePreAuthorizedCode(params: {
  tokenEndpoint: string;
  preAuthorizedCode: string;
  txCode?: string;
  fetch?: typeof fetch;
}): Promise<OidcTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", PRE_AUTHORIZED_CODE_GRANT);
  body.set("pre-authorized_code", params.preAuthorizedCode);
  if (params.txCode) body.set("tx_code", params.txCode);
  const response = await defaultFetch(params.fetch)(params.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `exchangePreAuthorizedCode: ${params.tokenEndpoint} → ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`,
    );
  }
  return (await response.json()) as OidcTokenResponse;
}

/**
 * Posts the holder proof JWT to the issuer's `credential_endpoint`
 * and returns the issued credential payload.
 */
export async function requestCredential(params: {
  credentialEndpoint: string;
  accessToken: string;
  format: string;
  /** SD-JWT VC type, ldp_vc context, etc. */
  vct?: string;
  /** `credential_definition` for `jwt_vc_json` / `ldp_vc` flows. */
  credentialDefinition?: Record<string, unknown>;
  proof: { proof_type: "jwt"; jwt: string };
  fetch?: typeof fetch;
}): Promise<CredentialEndpointResponse> {
  const body: Record<string, unknown> = {
    format: params.format,
    proof: params.proof,
  };
  if (params.vct) body.vct = params.vct;
  if (params.credentialDefinition) body.credential_definition = params.credentialDefinition;
  const response = await defaultFetch(params.fetch)(params.credentialEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `requestCredential: ${params.credentialEndpoint} → ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`,
    );
  }
  return (await response.json()) as CredentialEndpointResponse;
}

/**
 * Normalises Credo's response shapes (`credential` vs `credentials[]`,
 * each entry either a compact string or an object wrapping one) into
 * a single compact credential string.
 */
export function extractIssuedCredential(response: CredentialEndpointResponse): string {
  if (typeof response.credential === "string") return response.credential;
  if (Array.isArray(response.credentials) && response.credentials.length > 0) {
    const first = response.credentials[0];
    const compact = typeof first === "string" ? first : first?.credential;
    if (typeof compact === "string") return compact;
  }
  throw new Error("credential endpoint response did not contain a compact credential");
}

/**
 * Dereferences an offer-by-reference (`credential_offer_uri`) into
 * the full {@link CredentialOffer} JSON. Inline offers should be
 * read directly from {@link parseCredentialOfferUrl}.
 */
export async function resolveCredentialOfferReference(
  uri: string,
  options: OidcFetcher = {},
): Promise<CredentialOffer> {
  const response = await defaultFetch(options.fetch)(uri, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `resolveCredentialOfferReference: ${uri} → ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as CredentialOffer;
}

/**
 * High-level convenience: fetches the credential offer (by-value or
 * by-reference) for an `openid-credential-offer://...` URL.
 */
export async function fetchCredentialOffer(
  offerUrl: string,
  options: OidcFetcher = {},
): Promise<CredentialOffer> {
  const parsed = parseCredentialOfferUrl(offerUrl);
  if (parsed.kind === "value") return parsed.offer;
  return resolveCredentialOfferReference(parsed.uri, options);
}
