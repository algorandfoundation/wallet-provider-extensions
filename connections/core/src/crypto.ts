/**
 * The **secure channel** primitives of the connections domain.
 *
 * Once the connect handshake exchanged the peers' `did:key` identities,
 * each side reads the other's X25519 key from the DID document's
 * `keyAgreement` section, runs ECDH against its own identity key, and
 * folds the shared secret through HKDF into a symmetric key: the same
 * key on both sides, so either peer can seal frames the other opens
 * (XChaCha20-Poly1305).
 *
 * @remarks
 * This contract is deliberately INFORMAL. A proper encrypted messaging
 * spec will come later and replace it. Until then the shapes here stay
 * minimal: raw X25519 + HKDF-SHA256 + XChaCha20-Poly1305 with a per-frame
 * random nonce.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58, base64urlnopad } from "@scure/base";

/** Multicodec varint prefix of an Ed25519 public key: 0xed. */
const ED25519_PREFIX: [number, number] = [0xed, 0x01];
/** Multicodec varint prefix of an X25519 public key: 0xec. */
const X25519_PREFIX: [number, number] = [0xec, 0x01];

/** Curve25519 field prime: 2^255 - 19. */
const CURVE25519_P = 2n ** 255n - 19n;

/**
 * Default HKDF `info` binding derived keys to this secure-channel contract.
 *
 * @remarks
 * INFORMAL: the `v1` suffix tracks this interim contract; a proper
 * messaging spec will supersede it.
 *
 * @example
 * ```typescript
 * const channel = createSecureChannel({ sharedSecret, info: SECURE_CHANNEL_INFO });
 * ```
 */
export const SECURE_CHANNEL_INFO: string = "algorandfoundation/connections/secure-channel/v1";

/** Reduces into the Curve25519 field (result always non-negative). */
function curve25519Mod(a: bigint): bigint {
  const r = a % CURVE25519_P;
  return r >= 0n ? r : r + CURVE25519_P;
}

/** Modular inverse via Fermat's little theorem: a^(p-2) mod p. */
function curve25519Invert(a: bigint): bigint {
  let base = curve25519Mod(a);
  let exp = CURVE25519_P - 2n;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % CURVE25519_P;
    base = (base * base) % CURVE25519_P;
    exp >>= 1n;
  }
  return result;
}

/**
 * Converts an Ed25519 public key to its X25519 (Curve25519) equivalent
 * via the birational map `u = (1 + y) / (1 - y)`, the conversion the
 * did:key method prescribes for the key-agreement key of an Ed25519
 * identity. Lets this package interoperate with DID documents that
 * predate the `keyAgreement` section: the X25519 key is recoverable
 * from the identity's signing key alone.
 *
 * @param publicKey - The raw 32-byte Ed25519 public key.
 * @returns The raw 32-byte X25519 public key.
 * @throws When the key is not 32 bytes, encodes a value outside the
 * field, or has no X25519 equivalent (`y = 1`).
 *
 * @example
 * ```typescript
 * const remotePublicKey = edwardsToX25519PublicKey(peerEd25519PublicKey);
 * ```
 */
export function edwardsToX25519PublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error(`invalid Ed25519 public key: expected 32 bytes, got ${publicKey.length}`);
  }
  // The compressed encoding is y little-endian with the sign of x in the
  // top bit; the map only needs y, so the sign bit is simply cleared.
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    const byte = i === 31 ? publicKey[i] & 0x7f : publicKey[i];
    y = (y << 8n) | BigInt(byte);
  }
  if (y >= CURVE25519_P) {
    throw new Error("invalid Ed25519 public key: y is not a field element");
  }
  const denominator = curve25519Mod(1n - y);
  if (denominator === 0n) {
    throw new Error("invalid Ed25519 public key: no X25519 equivalent");
  }
  let u = curve25519Mod((1n + y) * curve25519Invert(denominator));
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(u & 0xffn);
    u >>= 8n;
  }
  return out;
}

/**
 * An X25519 key pair usable for the secure channel's key agreement.
 *
 * @example
 * ```typescript
 * const pair: X25519KeyPair = x25519KeyPairFromEd25519Seed(seed);
 * ```
 */
export interface X25519KeyPair {
  /** The raw 32-byte X25519 private key. */
  privateKey: Uint8Array;
  /** The raw 32-byte X25519 public key. */
  publicKey: Uint8Array;
}

/**
 * Derives the X25519 key pair of an Ed25519 identity from its 32-byte
 * seed, the standard RFC 8032/7748 bridge (the X25519 scalar is the
 * clamped lower half of `SHA-512(seed)`), so the derived public key
 * matches the `keyAgreement` entry peers compute from the identity's
 * Ed25519 PUBLIC key alone.
 *
 * @param seed - The 32-byte Ed25519 seed (private key).
 * @returns The identity's {@link X25519KeyPair}.
 *
 * @example
 * ```typescript
 * const { privateKey, publicKey } = x25519KeyPairFromEd25519Seed(identitySeed);
 * ```
 */
export function x25519KeyPairFromEd25519Seed(seed: Uint8Array): X25519KeyPair {
  if (seed.length !== 32) {
    throw new Error(`invalid Ed25519 seed: expected 32 bytes, got ${seed.length}`);
  }
  const privateKey = sha512(seed).slice(0, 32);
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** Decodes a multibase (`z` + base58btc) multicodec key of the given prefix. */
function decodeMultibaseKey(multibase: string, prefix: [number, number]): Uint8Array | undefined {
  if (!multibase.startsWith("z")) return undefined;
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multibase.slice(1));
  } catch {
    return undefined;
  }
  if (decoded.length < 3 || decoded[0] !== prefix[0] || decoded[1] !== prefix[1]) return undefined;
  return decoded.slice(2);
}

/**
 * Extracts the X25519 key-agreement public key from a peer's DID
 * document (the `didDocument` of an identity record exchanged in the
 * `connect` handshake's `domains.identities`).
 *
 * Resolution order:
 * 1. The `keyAgreement` section: entries may reference a verification
 *    method by id or embed one; `X25519KeyAgreementKey2020` multibase
 *    keys are used as-is, Ed25519 entries are converted.
 * 2. Fallback for documents without `keyAgreement`: the document's
 *    `did:key` identifier itself (an Ed25519 key), converted via
 *    {@link edwardsToX25519PublicKey}.
 *
 * @param didDocument - The peer's DID document (plain JSON).
 * @returns The raw 32-byte X25519 public key, or `undefined` when the
 * document carries no usable key-agreement key.
 *
 * @example
 * ```typescript
 * const remotePublicKey = keyAgreementPublicKey(peerIdentity.didDocument);
 * if (!remotePublicKey) throw new Error("peer has no key-agreement key");
 * ```
 */
export function keyAgreementPublicKey(didDocument: Record<string, any>): Uint8Array | undefined {
  const methods: Record<string, any>[] = Array.isArray(didDocument?.verificationMethod)
    ? didDocument.verificationMethod
    : [];

  const fromMultibase = (multibase: unknown): Uint8Array | undefined => {
    if (typeof multibase !== "string") return undefined;
    const asX25519 = decodeMultibaseKey(multibase, X25519_PREFIX);
    if (asX25519) return asX25519;
    const asEd25519 = decodeMultibaseKey(multibase, ED25519_PREFIX);
    if (asEd25519) {
      try {
        return edwardsToX25519PublicKey(asEd25519);
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const entries: unknown[] = Array.isArray(didDocument?.keyAgreement)
    ? didDocument.keyAgreement
    : [];
  for (const entry of entries) {
    // A string entry references a verification method by id; an object
    // entry embeds the method inline.
    const method =
      typeof entry === "string"
        ? methods.find((vm) => vm?.id === entry)
        : (entry as Record<string, any> | null);
    const key = fromMultibase(method?.publicKeyMultibase);
    if (key) return key;
  }

  // No keyAgreement section: fall back to converting the Ed25519
  // identity key of a did:key document.
  const id = typeof didDocument?.id === "string" ? didDocument.id : "";
  if (id.startsWith("did:key:")) {
    const key = fromMultibase(id.slice("did:key:".length));
    if (key) return key;
  }
  return undefined;
}

/**
 * A sealed secure-channel frame, JSON/wire-ready (both fields are
 * unpadded base64url strings).
 *
 * @example
 * ```typescript
 * const sealed: SealedMessage = channel.encrypt("hello");
 * ```
 */
export interface SealedMessage {
  /** The 24-byte XChaCha20 nonce, base64url (unpadded). */
  nonce: string;
  /** The ciphertext + Poly1305 tag, base64url (unpadded). */
  ciphertext: string;
}

/**
 * The symmetric encrypt/decrypt surface both peers derive from their
 * identity keys. Same key on both sides: either peer seals, the other
 * opens.
 *
 * @example
 * ```typescript
 * const text = channel.decryptText(channel.encrypt("hello"));
 * ```
 */
export interface SecureChannel {
  /** Seals a UTF-8 string or raw bytes into a wire-ready {@link SealedMessage}. */
  encrypt(plaintext: Uint8Array | string): SealedMessage;
  /** Opens a {@link SealedMessage}; throws when the payload was tampered with. */
  decrypt(sealed: SealedMessage): Uint8Array;
  /** {@link SecureChannel.decrypt} decoded as a UTF-8 string. */
  decryptText(sealed: SealedMessage): string;
}

/**
 * Options accepted by {@link createSecureChannel}.
 *
 * @example
 * ```typescript
 * const options: CreateSecureChannelOptions = { sharedSecret };
 * ```
 */
export interface CreateSecureChannelOptions {
  /**
   * This side's X25519 private key (e.g. via
   * {@link x25519KeyPairFromEd25519Seed}). Required together with
   * {@link remotePublicKey} unless {@link sharedSecret} is supplied.
   */
  privateKey?: Uint8Array;
  /**
   * The peer's X25519 public key, typically read from the
   * `keyAgreement` section of the identity exchanged during `connect`
   * (see {@link keyAgreementPublicKey}).
   */
  remotePublicKey?: Uint8Array;
  /**
   * A precomputed raw X25519 shared secret (the 32-byte ECDH output),
   * used INSTEAD of {@link privateKey}/{@link remotePublicKey}. This is
   * the seam for private keys that never surface as bytes, e.g. a
   * NON-extractable WebCrypto X25519 key, whose agreement runs inside
   * `SubtleCrypto` (`deriveBits`, or a keystore's `deriveSharedSecret`)
   * and hands back only the shared secret. Both construction paths fold
   * through the same HKDF, so a channel built from a shared secret
   * interoperates with one built from raw keys on the other side.
   */
  sharedSecret?: Uint8Array;
  /** HKDF `info` override binding the key to an application context. */
  info?: string;
}

/**
 * Builds the {@link SecureChannel} between two identities: X25519 ECDH
 * over the parties' key-agreement keys, HKDF-SHA256 into a 32-byte
 * XChaCha20-Poly1305 key. Both peers derive the SAME key
 * (`ECDH(a, B) == ECDH(b, A)`), so the channel is symmetric by
 * construction. A side whose private key is locked away (e.g. inside a
 * non-extractable WebCrypto key) runs the ECDH where the key lives and
 * passes the result as `sharedSecret` instead.
 *
 * @param options - {@link CreateSecureChannelOptions}.
 * @returns The {@link SecureChannel}.
 * @throws When neither `sharedSecret` nor both `privateKey` and
 * `remotePublicKey` are supplied.
 *
 * @example
 * ```typescript
 * const local = x25519KeyPairFromEd25519Seed(identitySeed);
 * const remote = keyAgreementPublicKey(peerIdentity.didDocument!);
 * const channel = createSecureChannel({
 *   privateKey: local.privateKey,
 *   remotePublicKey: remote!,
 * });
 * const sealed = channel.encrypt("hello");
 * ```
 */
export function createSecureChannel(options: CreateSecureChannelOptions): SecureChannel {
  let sharedSecret = options.sharedSecret;
  if (!sharedSecret) {
    if (!options.privateKey || !options.remotePublicKey) {
      throw new Error(
        "createSecureChannel requires a sharedSecret, or both privateKey and remotePublicKey",
      );
    }
    sharedSecret = x25519.getSharedSecret(options.privateKey, options.remotePublicKey);
  }
  const key = hkdf(
    sha256,
    sharedSecret,
    undefined,
    utf8ToBytes(options.info ?? SECURE_CHANNEL_INFO),
    32,
  );

  return {
    encrypt(plaintext: Uint8Array | string): SealedMessage {
      const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
      const nonce = randomBytes(24);
      const ciphertext = xchacha20poly1305(key, nonce).encrypt(bytes);
      return {
        nonce: base64urlnopad.encode(nonce),
        ciphertext: base64urlnopad.encode(ciphertext),
      };
    },
    decrypt(sealed: SealedMessage): Uint8Array {
      const nonce = base64urlnopad.decode(sealed.nonce);
      const ciphertext = base64urlnopad.decode(sealed.ciphertext);
      return xchacha20poly1305(key, nonce).decrypt(ciphertext);
    },
    decryptText(sealed: SealedMessage): string {
      return new TextDecoder().decode(this.decrypt(sealed));
    },
  };
}
