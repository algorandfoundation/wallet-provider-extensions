import { describe, expect, it } from "vitest";

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

import {
  createSecureChannel,
  edwardsToX25519PublicKey,
  keyAgreementPublicKey,
  x25519KeyPairFromEd25519Seed,
} from "./crypto.ts";

/** Deterministic Ed25519 seeds for the two peers. */
const SEED_A = new Uint8Array(32).fill(7);
const SEED_B = new Uint8Array(32).fill(42);

/** Encodes a raw key as a did:key-style multibase with the given prefix. */
function toMultibase(key: Uint8Array, prefix: [number, number]): string {
  const prefixed = new Uint8Array(2 + key.length);
  prefixed.set(prefix);
  prefixed.set(key, 2);
  return `z${base58.encode(prefixed)}`;
}

/** Builds the minimal DID document a wallet's identity would expose. */
function makeDidDocument(edPublicKey: Uint8Array): Record<string, any> {
  const did = `did:key:${toMultibase(edPublicKey, [0xed, 0x01])}`;
  const x25519Multibase = toMultibase(edwardsToX25519PublicKey(edPublicKey), [0xec, 0x01]);
  const keyAgreementId = `${did}#${x25519Multibase}`;
  return {
    id: did,
    verificationMethod: [
      {
        id: `${did}#${did.slice("did:key:".length)}`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyMultibase: did.slice("did:key:".length),
      },
      {
        id: keyAgreementId,
        type: "X25519KeyAgreementKey2020",
        controller: did,
        publicKeyMultibase: x25519Multibase,
      },
    ],
    keyAgreement: [keyAgreementId],
  };
}

describe("X25519 key derivation", () => {
  it("bridges the private and public conversions to the same key", () => {
    // The X25519 public key derived from the SEED (private path) must be
    // the one peers derive from the Ed25519 PUBLIC key alone; otherwise
    // the two sides of a channel would disagree.
    const pair = x25519KeyPairFromEd25519Seed(SEED_A);
    const fromPublic = edwardsToX25519PublicKey(ed25519.getPublicKey(SEED_A));
    expect(pair.publicKey).toEqual(fromPublic);
  });

  it("matches the did:key spec test vector", () => {
    const ed = base58.decode("z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp".slice(1));
    const x = edwardsToX25519PublicKey(ed.slice(2)); // strip [0xed, 0x01]
    expect(toMultibase(x, [0xec, 0x01])).toBe("z6LShs9GGnqk85isEBzzshkuVWrVKsRp24GnDuHk8QWkARMW");
  });

  it("rejects seeds and keys of the wrong length", () => {
    expect(() => x25519KeyPairFromEd25519Seed(new Uint8Array(16))).toThrow(/32 bytes/);
    expect(() => edwardsToX25519PublicKey(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe("keyAgreementPublicKey", () => {
  const edPublicKey = ed25519.getPublicKey(SEED_A);
  const expected = edwardsToX25519PublicKey(edPublicKey);

  it("reads the X25519 key referenced by the keyAgreement section", () => {
    expect(keyAgreementPublicKey(makeDidDocument(edPublicKey))).toEqual(expected);
  });

  it("accepts an embedded keyAgreement verification method", () => {
    const doc = makeDidDocument(edPublicKey);
    const embedded = doc.verificationMethod[1];
    expect(keyAgreementPublicKey({ id: doc.id, keyAgreement: [embedded] })).toEqual(expected);
  });

  it("falls back to converting the did:key Ed25519 identifier", () => {
    const did = `did:key:${toMultibase(edPublicKey, [0xed, 0x01])}`;
    expect(keyAgreementPublicKey({ id: did })).toEqual(expected);
  });

  it("converts an Ed25519 keyAgreement entry when no X25519 key is present", () => {
    const did = `did:key:${toMultibase(edPublicKey, [0xed, 0x01])}`;
    const doc = {
      id: did,
      verificationMethod: [
        {
          id: `${did}#key-1`,
          type: "Ed25519VerificationKey2020",
          controller: did,
          publicKeyMultibase: toMultibase(edPublicKey, [0xed, 0x01]),
        },
      ],
      keyAgreement: [`${did}#key-1`],
    };
    expect(keyAgreementPublicKey(doc)).toEqual(expected);
  });

  it("returns undefined for documents without a usable key", () => {
    expect(keyAgreementPublicKey({})).toBeUndefined();
    expect(keyAgreementPublicKey({ id: "did:web:example.com" })).toBeUndefined();
    expect(
      keyAgreementPublicKey({ id: "did:key:zNotAKey", keyAgreement: ["did:key:zNope#frag"] }),
    ).toBeUndefined();
  });
});

describe("createSecureChannel", () => {
  // Each side derives the channel from its OWN seed and the PEER's DID
  // document, exactly what the connect handshake makes possible.
  const pairA = x25519KeyPairFromEd25519Seed(SEED_A);
  const pairB = x25519KeyPairFromEd25519Seed(SEED_B);
  const docA = makeDidDocument(ed25519.getPublicKey(SEED_A));
  const docB = makeDidDocument(ed25519.getPublicKey(SEED_B));

  const channelA = createSecureChannel({
    privateKey: pairA.privateKey,
    remotePublicKey: keyAgreementPublicKey(docB)!,
  });
  const channelB = createSecureChannel({
    privateKey: pairB.privateKey,
    remotePublicKey: keyAgreementPublicKey(docA)!,
  });

  it("round-trips both directions with the shared key", () => {
    const fromA = channelA.encrypt("hello from A");
    expect(channelB.decryptText(fromA)).toBe("hello from A");

    const fromB = channelB.encrypt("hello from B");
    expect(channelA.decryptText(fromB)).toBe("hello from B");
  });

  it("seals raw bytes too", () => {
    const payload = new Uint8Array([1, 2, 3, 250]);
    expect(channelB.decrypt(channelA.encrypt(payload))).toEqual(payload);
  });

  it("uses a fresh nonce per frame", () => {
    const first = channelA.encrypt("same text");
    const second = channelA.encrypt("same text");
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = channelA.encrypt("do not touch");
    const tampered = {
      ...sealed,
      ciphertext: sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith("A") ? "BB" : "AA"),
    };
    expect(() => channelB.decrypt(tampered)).toThrow();
  });

  it("rejects frames sealed for a different peer", () => {
    const stranger = x25519KeyPairFromEd25519Seed(new Uint8Array(32).fill(99));
    const wrongChannel = createSecureChannel({
      privateKey: stranger.privateKey,
      remotePublicKey: pairA.publicKey,
    });
    expect(() => wrongChannel.decrypt(channelA.encrypt("secret"))).toThrow();
  });

  it("binds the derived key to the HKDF info context", () => {
    const other = createSecureChannel({
      privateKey: pairB.privateKey,
      remotePublicKey: pairA.publicKey,
      info: "another-context",
    });
    expect(() => other.decrypt(channelA.encrypt("secret"))).toThrow();
  });

  it("interoperates with a channel built from a precomputed shared secret", () => {
    // The seam a non-extractable WebCrypto X25519 key uses: the ECDH runs
    // inside SubtleCrypto (deriveBits / a keystore's deriveSharedSecret)
    // and only the 32-byte shared secret reaches the channel. It must
    // fold into the SAME key the raw-key construction derives.
    const sharedSecret = x25519.getSharedSecret(pairA.privateKey, pairB.publicKey);
    const fromSecret = createSecureChannel({ sharedSecret });

    expect(channelB.decryptText(fromSecret.encrypt("sealed via shared secret"))).toBe(
      "sealed via shared secret",
    );
    expect(fromSecret.decryptText(channelB.encrypt("opened via shared secret"))).toBe(
      "opened via shared secret",
    );
  });

  it("requires a shared secret or a full key pair", () => {
    expect(() => createSecureChannel({})).toThrow(/sharedSecret/);
    expect(() => createSecureChannel({ privateKey: pairA.privateKey })).toThrow(/sharedSecret/);
    expect(() => createSecureChannel({ remotePublicKey: pairB.publicKey })).toThrow(/sharedSecret/);
  });
});
