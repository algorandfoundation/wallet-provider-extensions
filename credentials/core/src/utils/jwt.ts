import { base64UrlDecodeToString, base64UrlEncode } from "./base64.ts";
import type { JwsSigner } from "./signer.ts";

/**
 * Decoded representation of a compact JWS / JWT.
 */
export interface DecodedJwt<P = Record<string, unknown>> {
  header: Record<string, unknown>;
  payload: P;
  signature: string;
  signingInput: string;
}

/**
 * Decodes a compact-serialized JWT (`<header>.<payload>.<signature>`)
 * without verifying its signature. Verification is delegated to the
 * relying party (Credo on the server side); the holder wallet only
 * needs to inspect claims for display / disclosure-selection.
 */
export function decodeJwt<P = Record<string, unknown>>(jwt: string): DecodedJwt<P> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid compact JWT: expected 3 segments, got ${parts.length}`);
  }
  const [h, p, signature] = parts;
  const header = JSON.parse(base64UrlDecodeToString(h)) as Record<string, unknown>;
  const payload = JSON.parse(base64UrlDecodeToString(p)) as P;
  return {
    header,
    payload,
    signature,
    signingInput: `${h}.${p}`,
  };
}

/**
 * Builds and signs a compact JWS over the given header + payload using
 * the supplied {@link JwsSigner}. The signer's `alg` (and optional
 * `kid`) are merged into the header if not already present.
 *
 * Used to assemble:
 *  - OID4VCI holder proof-of-possession JWTs (`jwt` proof_type)
 *  - SD-JWT key-binding JWTs (`typ: kb+jwt`)
 *  - OID4VP VP token JWTs
 */
export async function signCompactJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signer: JwsSigner,
): Promise<string> {
  const finalHeader = {
    alg: signer.alg,
    ...(signer.kid ? { kid: signer.kid } : {}),
    ...header,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(finalHeader));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sigBytes = await signer.sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(sigBytes)}`;
}
