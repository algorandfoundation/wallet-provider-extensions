import { describe, expect, it } from "vitest";
import { base58 } from "@scure/base";

import { edwardsToX25519PublicKey, generateDidDocument, generateDidKey } from "./did-document.ts";

/**
 * did:key test vector (W3C CCG did:key method): the Ed25519 identity and
 * the X25519 key-agreement key its DID document must derive from it.
 */
const ED25519_DID = "did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp";
const X25519_MULTIBASE = "z6LShs9GGnqk85isEBzzshkuVWrVKsRp24GnDuHk8QWkARMW";

/** Decodes the raw Ed25519 public key out of a did:key identifier. */
function publicKeyFromDid(did: string): Uint8Array {
  const multibase = did.slice("did:key:".length);
  return base58.decode(multibase.slice(1)).slice(2); // strip 'z' + [0xed, 0x01]
}

describe("edwardsToX25519PublicKey", () => {
  it("derives the spec test vector's X25519 key from its Ed25519 key", () => {
    const x25519PublicKey = edwardsToX25519PublicKey(publicKeyFromDid(ED25519_DID));
    const prefixed = new Uint8Array(34);
    prefixed.set([0xec, 0x01]);
    prefixed.set(x25519PublicKey, 2);
    expect(`z${base58.encode(prefixed)}`).toBe(X25519_MULTIBASE);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => edwardsToX25519PublicKey(new Uint8Array(31))).toThrow(/32 bytes/);
  });

  it("rejects keys without an X25519 equivalent (y = 1)", () => {
    const yOne = new Uint8Array(32);
    yOne[0] = 1; // y = 1 little-endian → 1 - y = 0, no birational image
    expect(() => edwardsToX25519PublicKey(yOne)).toThrow(/no X25519 equivalent/);
  });
});

describe("generateDidDocument keyAgreement", () => {
  const publicKey = publicKeyFromDid(ED25519_DID);
  const did = generateDidKey(publicKey);

  it("round-trips the did:key identifier", () => {
    expect(did).toBe(ED25519_DID);
  });

  it("includes an X25519 keyAgreement section derived from the identity key", () => {
    const doc = generateDidDocument(did, publicKey);

    expect(doc.keyAgreement).toEqual([`${did}#${X25519_MULTIBASE}`]);

    const method = doc.verificationMethod.find((vm) => vm.id === doc.keyAgreement![0]);
    expect(method).toMatchObject({
      type: "X25519KeyAgreementKey2020",
      controller: did,
      publicKeyMultibase: X25519_MULTIBASE,
    });
    expect(doc["@context"]).toContain("https://w3id.org/security/suites/x25519-2020/v1");
  });

  it("injects no default service: `service` holds exactly the additional services", () => {
    expect(generateDidDocument(did, publicKey).service).toEqual([]);

    const hub = {
      id: `${did}#hub`,
      type: "DIDCommMessaging",
      serviceEndpoint: "https://hub.example/inbox",
    };
    const doc = generateDidDocument(did, publicKey, [], [hub]);
    expect(doc.service).toEqual([hub]);
    expect(doc.service.some((s) => s.type === "WebRTCICECredentials")).toBe(false);
    expect(JSON.stringify(doc)).not.toContain("stun:");
  });

  it("keeps authentication/assertion pointing at the Ed25519 key only", () => {
    const doc = generateDidDocument(did, publicKey);
    const keyAgreementId = doc.keyAgreement![0];

    expect(doc.authentication).not.toContain(keyAgreementId);
    expect(doc.assertionMethod).not.toContain(keyAgreementId);
  });

  it("advertises an explicitly supplied X25519 key instead of the derived twin", () => {
    // The seam for identities whose agreement key lives elsewhere, e.g. a
    // separate NON-extractable WebCrypto X25519 key (the Ed25519 signing
    // key can't lend its private material to the birational conversion).
    const separateKey = new Uint8Array(32).fill(9);
    const doc = generateDidDocument(did, publicKey, [], [], undefined, undefined, separateKey);

    const method = doc.verificationMethod.find((vm) => vm.id === doc.keyAgreement![0]);
    expect(method?.type).toBe("X25519KeyAgreementKey2020");
    expect(method?.publicKeyMultibase).not.toBe(X25519_MULTIBASE);

    const decoded = base58.decode(method!.publicKeyMultibase!.slice(1));
    expect(Array.from(decoded.slice(0, 2))).toEqual([0xec, 0x01]); // X25519 multicodec
    expect(decoded.slice(2)).toEqual(separateKey);
  });
});
