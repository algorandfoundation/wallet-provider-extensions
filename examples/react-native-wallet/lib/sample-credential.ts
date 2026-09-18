import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  base64UrlEncode,
  parseSdJwtVc,
  signCompactJwt,
  type Credential,
  type CredentialStoreApi,
} from "@algorandfoundation/credentials";

/**
 * Credential type URI advertised in the sample SD-JWT VC's `vct` claim.
 */
export const SAMPLE_VCT = "https://example.com/credentials/demo-attestation";

/**
 * Selectively-disclosable claims baked into the sample credential.
 * Each one becomes an SD-JWT disclosure the holder can reveal (or
 * withhold) per presentation.
 */
const SAMPLE_CLAIMS: Record<string, unknown> = {
  given_name: "Ada",
  family_name: "Lovelace",
  membership_level: "gold",
};

/**
 * Encodes a single SD-JWT object-member disclosure
 * (`base64url(JSON.stringify([salt, name, value]))`) and its SHA-256
 * digest as referenced from the issuer JWT's `_sd` array.
 */
function encodeDisclosure(name: string, value: unknown): { encoded: string; digest: string } {
  const salt = base64UrlEncode(randomBytes(16));
  const encoded = base64UrlEncode(JSON.stringify([salt, name, value]));
  const digest = base64UrlEncode(sha256(new TextEncoder().encode(encoded)));
  return { encoded, digest };
}

/**
 * Self-issues a sample SD-JWT VC bound to the given identity and stores it.
 *
 * The demo has no issuance backend, so the holder identity plays issuer
 * too: the credential is signed with the identity's own `did:key` (the
 * signer resolves through the credential store's holder binding), and the
 * `cnf` claim binds it back to the same key. The result is a structurally
 * real SD-JWT VC (issuer JWT + selective disclosures) the wallet can
 * later present through OID4VP or the Digital Credentials API.
 *
 * @param credentialStore - The `provider.credential.store` API.
 * @param holder - The identity that will hold (and self-issue) the credential.
 * @returns The stored {@link Credential} record.
 */
export async function issueSampleCredential(
  credentialStore: CredentialStoreApi,
  holder: { address: string; did?: string },
): Promise<Credential> {
  const signer = await credentialStore.getSignerForIdentity(holder.address);
  if (!signer) {
    throw new Error(
      "The selected identity cannot sign — no holder binding resolved a signer for it.",
    );
  }

  const holderDid = holder.did ?? holder.address;
  const disclosures = Object.entries(SAMPLE_CLAIMS).map(([name, value]) =>
    encodeDisclosure(name, value),
  );

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60 * 24 * 365; // one year
  const jwt = await signCompactJwt(
    { typ: "vc+sd-jwt" },
    {
      iss: holderDid,
      vct: SAMPLE_VCT,
      iat,
      exp,
      cnf: signer.kid ? { kid: signer.kid } : { jwk: signer.publicKeyJwk },
      _sd: disclosures.map((d) => d.digest),
      _sd_alg: "sha-256",
    },
    signer,
  );

  // Compact SD-JWT VC serialization: <issuer-jwt>~<disclosure>~...~
  const compact = `${jwt}~${disclosures.map((d) => d.encoded).join("~")}~`;
  const parsed = parseSdJwtVc(compact);
  const id = base64UrlEncode(sha256(new TextEncoder().encode(compact)));

  return credentialStore.addCredential({
    id,
    type: ["VerifiableCredential", "DemoAttestation"],
    identityAddress: holder.address,
    name: "Demo Attestation",
    description: "Self-issued sample SD-JWT VC for the Digital Credentials demo",
    tags: ["demo"],
    format: "vc+sd-jwt",
    raw: compact,
    claims: parsed.claims,
    issuer: holderDid,
    holder: holderDid,
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    receivedAt: Date.now(),
  });
}
