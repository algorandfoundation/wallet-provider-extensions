import { buildSdJwtPresentation, parseSdJwtVc } from "./sd-jwt-vc.ts";
import type { Credential } from "../types.ts";
import type { JwsSigner } from "./signer.ts";

/**
 * Builds the value of the `X-Credential-Presentation` header consumed
 * by credential-gated intermezzo endpoints — an SD-JWT VC
 * presentation with a freshly-signed key-binding JWT bound to a
 * server-issued nonce.
 *
 * The wallet flow is:
 *
 * 1. Call the guarded endpoint without the header to obtain a nonce
 *    challenge (or use a nonce already in hand).
 * 2. Use this helper to attach the device-attestation credential.
 * 3. Re-call the endpoint with the resulting header value.
 */
export async function buildCredentialPresentationHeader(params: {
  /** A stored SD-JWT VC credential (typ. the device-attestation credential). */
  credential: Pick<Credential, "raw" | "format">;
  /** Signer for the holder key bound in `cnf` of the SD-JWT VC. */
  signer: JwsSigner;
  /** Audience the verifier expects in the key-binding JWT (`aud`). */
  audience: string;
  /** Server-issued nonce. */
  nonce: string;
  /** Claim names to disclose. Defaults to all member-disclosures. */
  disclose?: string[];
  issuedAt?: number;
}): Promise<string> {
  if (params.credential.format !== "vc+sd-jwt") {
    throw new Error(
      `X-Credential-Presentation requires an SD-JWT VC; got format=${params.credential.format}`,
    );
  }
  const compact =
    typeof params.credential.raw === "string"
      ? params.credential.raw
      : new TextDecoder().decode(params.credential.raw);

  const parsed = parseSdJwtVc(compact);
  const disclose =
    params.disclose ?? parsed.disclosures.map((d) => d.name).filter((n): n is string => !!n);

  return buildSdJwtPresentation({
    parsed,
    disclose,
    keyBinding: {
      signer: params.signer,
      audience: params.audience,
      nonce: params.nonce,
      issuedAt: params.issuedAt,
    },
  });
}
