import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64UrlEncode } from "./base64.ts";
import { decodeJwt } from "./jwt.ts";
import { buildSdJwtPresentation, parseSdJwtVc } from "./sd-jwt-vc.ts";
import type { JwsSigner } from "./signer.ts";

/** Encodes an object-member disclosure and returns its digest. */
function makeDisclosure(salt: string, name: string, value: unknown) {
  const encoded = base64UrlEncode(JSON.stringify([salt, name, value]));
  const digest = base64UrlEncode(sha256(new TextEncoder().encode(encoded)));
  return { encoded, digest };
}

function makeIssuerJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "EdDSA", typ: "vc+sd-jwt" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.${base64UrlEncode("fake-signature")}`;
}

const stubSigner: JwsSigner = {
  alg: "EdDSA",
  kid: "did:key:z6Mk...#z6Mk...",
  publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "AAAA" },
  async sign() {
    return new Uint8Array([1, 2, 3]);
  },
};

describe("SD-JWT VC", () => {
  const given = makeDisclosure("salt1", "given_name", "Ada");
  const family = makeDisclosure("salt2", "family_name", "Lovelace");

  const issuerJwt = makeIssuerJwt({
    iss: "did:web:issuer.example.com",
    vct: "device-attestation-credential",
    _sd: [given.digest, family.digest],
    _sd_alg: "sha-256",
    cnf: { kid: "did:key:z6Mk...#z6Mk..." },
  });

  const compact = `${issuerJwt}~${given.encoded}~${family.encoded}~`;

  it("parses disclosures and materialises the claim set", () => {
    const parsed = parseSdJwtVc(compact);

    expect(parsed.jwt).toBe(issuerJwt);
    expect(parsed.keyBindingJwt).toBeUndefined();
    expect(parsed.disclosures).toHaveLength(2);
    expect(parsed.claims).toMatchObject({
      vct: "device-attestation-credential",
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(parsed.claims).not.toHaveProperty("_sd");
    expect(parsed.claims).not.toHaveProperty("_sd_alg");
  });

  it("silently drops undisclosed digests", () => {
    const partial = `${issuerJwt}~${given.encoded}~`;
    const parsed = parseSdJwtVc(partial);
    expect(parsed.claims).toHaveProperty("given_name", "Ada");
    expect(parsed.claims).not.toHaveProperty("family_name");
  });

  it("detects a trailing key-binding JWT", () => {
    const kb = makeIssuerJwt({ nonce: "n" });
    const parsed = parseSdJwtVc(`${issuerJwt}~${given.encoded}~${kb}`);
    expect(parsed.keyBindingJwt).toBe(kb);
    expect(parsed.disclosures).toHaveLength(1);
  });

  it("builds a presentation with selected disclosures only", async () => {
    const parsed = parseSdJwtVc(compact);
    const presentation = await buildSdJwtPresentation({ parsed, disclose: ["given_name"] });
    expect(presentation).toBe(`${issuerJwt}~${given.encoded}~`);
  });

  it("appends a signed key-binding JWT bound to the presentation hash", async () => {
    const parsed = parseSdJwtVc(compact);
    const presentation = await buildSdJwtPresentation({
      parsed,
      disclose: ["given_name"],
      keyBinding: {
        signer: stubSigner,
        audience: "https://verifier.example.com",
        nonce: "server-nonce",
        issuedAt: 1_700_000_000,
      },
    });

    const base = `${issuerJwt}~${given.encoded}~`;
    expect(presentation.startsWith(base)).toBe(true);

    const kbJwt = presentation.slice(base.length);
    const decoded = decodeJwt(kbJwt);
    expect(decoded.header).toMatchObject({ typ: "kb+jwt", alg: "EdDSA" });
    expect(decoded.payload).toMatchObject({
      aud: "https://verifier.example.com",
      nonce: "server-nonce",
      iat: 1_700_000_000,
      sd_hash: base64UrlEncode(sha256(new TextEncoder().encode(base))),
    });
  });

  it("round-trips presentation → parse", async () => {
    const parsed = parseSdJwtVc(compact);
    const presentation = await buildSdJwtPresentation({
      parsed,
      disclose: ["family_name"],
      keyBinding: { signer: stubSigner, audience: "aud", nonce: "n" },
    });

    const reparsed = parseSdJwtVc(presentation);
    expect(reparsed.claims).toHaveProperty("family_name", "Lovelace");
    expect(reparsed.claims).not.toHaveProperty("given_name");
    expect(reparsed.keyBindingJwt).toBeDefined();
  });
});
