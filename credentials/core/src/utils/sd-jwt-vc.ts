import { sha256 } from "@noble/hashes/sha2.js";
import { base64UrlDecodeToString, base64UrlEncode } from "./base64.ts";
import { decodeJwt, signCompactJwt } from "./jwt.ts";
import type { JwsSigner } from "./signer.ts";

/**
 * A parsed SD-JWT VC ("IETF SD-JWT VC") in compact serialization.
 *
 * Wire format (from `draft-ietf-oauth-sd-jwt-vc`):
 *
 *   <issuer-signed JWT>~<disclosure>~<disclosure>~...~[<kb-jwt>]
 *
 * Each disclosure is `base64url(JSON.stringify([salt, name, value]))`
 * for object members, or `base64url(JSON.stringify([salt, value]))`
 * for array elements. The issuer JWT references disclosures by their
 * SHA-256 digest in `_sd` arrays (or `...` placeholders in arrays).
 *
 * The intermezzo issuance flow produces an SD-JWT VC for the
 * device-attestation credential; credential-gated endpoints require
 * presenting it back as `X-Credential-Presentation`.
 */
export interface ParsedSdJwtVc {
  /** Raw compact issuer-signed JWT (`<h>.<p>.<s>`). */
  jwt: string;
  /** Decoded issuer JWT header + payload. */
  header: Record<string, unknown>;
  payload: SdJwtVcPayload;
  /** All disclosure blobs (base64url JSON arrays), keyed by digest. */
  disclosures: Disclosure[];
  /** The materialised claim set with disclosures merged in. */
  claims: Record<string, unknown>;
  /** Optional appended key-binding JWT. */
  keyBindingJwt?: string;
}

export interface SdJwtVcPayload {
  /** Issuer DID / URL. */
  iss?: string;
  /** Verifiable Credential type (e.g. `device-attestation-credential`). */
  vct?: string;
  /** Issued-at (seconds since epoch). */
  iat?: number;
  /** Expires-at (seconds since epoch). */
  exp?: number;
  /** Holder binding — JWK or DID of the key the holder must prove control of. */
  cnf?: { jwk?: Record<string, unknown>; kid?: string };
  /** Status list reference (revocation). */
  status?: Record<string, unknown>;
  /** Hash alg for `_sd` digests; defaults to `sha-256`. */
  _sd_alg?: string;
  [k: string]: unknown;
}

export interface Disclosure {
  /** Original base64url-encoded disclosure string. */
  encoded: string;
  /** Disclosure digest (base64url(sha256(encoded))). */
  digest: string;
  /** `[salt, name, value]` for object members; `[salt, value]` for array elements. */
  decoded: unknown[];
  /** Claim name (undefined for array-element disclosures). */
  name?: string;
  /** Disclosed value. */
  value: unknown;
}

function hashDisclosure(encoded: string, alg: string): string {
  if (alg !== "sha-256" && alg !== "sha256") {
    throw new Error(`Unsupported _sd_alg: ${alg}`);
  }
  const digest = sha256(new TextEncoder().encode(encoded));
  return base64UrlEncode(digest);
}

function decodeDisclosure(encoded: string, alg: string): Disclosure {
  const decoded = JSON.parse(base64UrlDecodeToString(encoded)) as unknown[];
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error("Malformed SD-JWT disclosure: not an array of length ≥ 2");
  }
  const isObjectMember = decoded.length === 3;
  return {
    encoded,
    digest: hashDisclosure(encoded, alg),
    decoded,
    name: isObjectMember ? (decoded[1] as string) : undefined,
    value: isObjectMember ? decoded[2] : decoded[1],
  };
}

/**
 * Recursively walks an issuer claims object and replaces any `_sd`
 * digests with their corresponding disclosure values. Array elements
 * encoded as `{ "...": "<digest>" }` are likewise resolved.
 *
 * Undisclosed digests are silently dropped — that is the whole point
 * of selective disclosure.
 */
function mergeDisclosures(node: unknown, byDigest: Map<string, Disclosure>): unknown {
  if (Array.isArray(node)) {
    return node
      .map((item) => {
        if (item && typeof item === "object" && "..." in (item as object)) {
          const digest = (item as { "...": string })["..."];
          const d = byDigest.get(digest);
          return d ? mergeDisclosures(d.value, byDigest) : undefined;
        }
        return mergeDisclosures(item, byDigest);
      })
      .filter((v) => v !== undefined);
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "_sd" && Array.isArray(v)) {
        for (const digest of v as string[]) {
          const d = byDigest.get(digest);
          if (d && d.name !== undefined) {
            out[d.name] = mergeDisclosures(d.value, byDigest);
          }
        }
        continue;
      }
      if (k === "_sd_alg") continue;
      out[k] = mergeDisclosures(v, byDigest);
    }
    return out;
  }
  return node;
}

/**
 * Parses an SD-JWT VC in compact serialization (with or without a
 * trailing key-binding JWT) and materialises the full claim set.
 *
 * The signature on the issuer JWT is **not** verified — verification
 * is performed by the relying party (Credo verifier). The wallet uses
 * the decoded claims for UI rendering and disclosure selection.
 */
export function parseSdJwtVc(compact: string): ParsedSdJwtVc {
  const segments = compact.split("~");
  if (segments.length < 1) {
    throw new Error("Empty SD-JWT VC");
  }
  const jwt = segments[0];
  const decoded = decodeJwt<SdJwtVcPayload>(jwt);
  const alg = (decoded.payload._sd_alg as string | undefined) ?? "sha-256";

  // The last segment is either "" (trailing ~), or a KB-JWT (contains ".").
  const last = segments[segments.length - 1];
  const hasKbJwt = last !== "" && last.split(".").length === 3;
  const keyBindingJwt = hasKbJwt ? last : undefined;
  const disclosureSegments = segments.slice(1, hasKbJwt ? -1 : segments.length).filter(Boolean);
  const disclosures = disclosureSegments.map((seg) => decodeDisclosure(seg, alg));

  const byDigest = new Map(disclosures.map((d) => [d.digest, d]));
  const claims = mergeDisclosures(decoded.payload, byDigest) as Record<string, unknown>;

  return {
    jwt,
    header: decoded.header,
    payload: decoded.payload,
    disclosures,
    claims,
    keyBindingJwt,
  };
}

/**
 * Selects a subset of disclosures by claim name and assembles a
 * presentation string. Optionally appends a freshly-signed key-binding
 * JWT (required by OID4VP when the verifier sends `kb_jwt` requirements
 * and by credential-gated intermezzo endpoints).
 *
 * The key-binding JWT is signed over `sha256(<issuer-jwt>~<d1>~...~<dn>~)`
 * per `draft-ietf-oauth-sd-jwt-vc` §4.3.
 */
export async function buildSdJwtPresentation(params: {
  parsed: ParsedSdJwtVc;
  /** Claim names to disclose. Omit to disclose nothing (presentation of bare JWT). */
  disclose?: string[];
  /** When provided, a `kb+jwt` is appended and signed by this signer. */
  keyBinding?: {
    signer: JwsSigner;
    audience: string;
    nonce: string;
    issuedAt?: number;
  };
}): Promise<string> {
  const { parsed, disclose, keyBinding } = params;
  const selected = disclose
    ? parsed.disclosures.filter((d) => d.name !== undefined && disclose.includes(d.name))
    : [];

  const base = `${parsed.jwt}~${selected.map((d) => d.encoded).join("~")}${selected.length ? "~" : ""}`;

  if (!keyBinding) {
    return base;
  }
  const sdHash = base64UrlEncode(sha256(new TextEncoder().encode(base)));
  const kbJwt = await signCompactJwt(
    { typ: "kb+jwt" },
    {
      iat: keyBinding.issuedAt ?? Math.floor(Date.now() / 1000),
      aud: keyBinding.audience,
      nonce: keyBinding.nonce,
      sd_hash: sdHash,
    },
    keyBinding.signer,
  );
  return `${base}${kbJwt}`;
}
