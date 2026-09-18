/**
 * The identities domain's key slice: narrowing over the local browser
 * keystore's keys that back a local identity (see `../localIdentities.ts`
 * for the identity projection).
 *
 * Keys are generated inside the IndexedDB-backed web keystore
 * (`@algorandfoundation/keystore-web`): private material never surfaces
 * to JS; it lives in non-extractable WebCrypto keys, and the reactive
 * `keyStore` mirrors only metadata. An identity is a PAIR of them: an
 * Ed25519 **signing key** and a companion X25519 **key-agreement key**
 * (WebCrypto limits Ed25519 keys to `sign`/`verify`, so the ECDH runs on
 * the separate X25519 key instead, straight through the keystore's own
 * `deriveSharedSecret` on `provider.key.store`, see
 * `../../keys/connections/encryption.ts`).
 */

import type { Key } from "@algorandfoundation/keystore";

/** The `metadata.context` tag identity keys carry (mirrors the wallet's XHD context 1). */
export const IDENTITY_CONTEXT = 1;

/** Returns true when the key is one of this dapp's local identity keys. */
export function isIdentityKey(key: Key): boolean {
  return key.type === "ed25519" && key.metadata?.context === IDENTITY_CONTEXT;
}

/** Returns true when the key is an identity's X25519 key-agreement companion. */
export function isKeyAgreementKey(key: Key): boolean {
  return key.algorithm === "X25519" && key.metadata?.context === IDENTITY_CONTEXT;
}

/**
 * The 12-byte DER header of an X25519 SubjectPublicKeyInfo document
 * (RFC 8410): `SEQUENCE { AlgorithmIdentifier { id-X25519 }, BIT STRING }`.
 * The keystore mirrors host-generated public halves as SPKI; the raw
 * 32-byte key is simply what follows this header.
 */
const X25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);

/**
 * Normalizes an X25519 public key to its raw 32 bytes: accepts the raw
 * form as-is and unwraps the SPKI document the keystore records for
 * host-generated keys (`Key.publicKey`).
 *
 * @throws When the bytes are neither a raw X25519 key nor an X25519 SPKI.
 */
export function rawX25519PublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 32) return publicKey;
  if (
    publicKey.length === X25519_SPKI_PREFIX.length + 32 &&
    X25519_SPKI_PREFIX.every((byte, i) => publicKey[i] === byte)
  ) {
    return publicKey.slice(X25519_SPKI_PREFIX.length);
  }
  throw new Error("not an X25519 public key (raw or SPKI)");
}
