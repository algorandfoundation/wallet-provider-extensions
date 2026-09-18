import { base58 } from "@scure/base";
import type { DIDDocument, VerificationMethod, Service } from "./types.ts";

/** Curve25519 field prime: 2^255 - 19. */
const CURVE25519_P = 2n ** 255n - 19n;

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
 * did:key method prescribes for deriving the key-agreement key of an
 * Ed25519 identity.
 *
 * @param publicKey - The raw 32-byte Ed25519 public key.
 * @returns The raw 32-byte X25519 public key.
 * @throws When the key is not 32 bytes, encodes a value outside the
 * field, or has no X25519 equivalent (`y = 1`).
 *
 * @example
 * ```typescript
 * const x25519 = edwardsToX25519PublicKey(ed25519PublicKey);
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
 * Generate a DID Document for did:key method following W3C JSON-LD spec
 * @param did - The DID identifier (e.g., "did:key:z...")
 * @param publicKey - The raw Ed25519 public key bytes
 * @param additionalKeys - Optional additional keys to include (e.g., account keys)
 * @param additionalServices - Optional additional services to include
 * @param mainKeyMetadata - Optional metadata recorded on the main verification method
 * @param mainKeyId - Optional fragment appended to the main verification method id
 * @param keyAgreementPublicKey - Optional raw 32-byte X25519 public key to
 *   advertise in `keyAgreement` INSTEAD of the twin derived from the Ed25519
 *   key. Use this when the identity's key agreement runs on a separate key,
 *   e.g. a non-extractable WebCrypto X25519 key, whose ECDH happens inside
 *   the host: the derived twin's private half is only computable from the
 *   signing key's private material, which such a key never releases.
 * @returns W3C compliant DID Document. The `service` array holds exactly the
 *   `additionalServices` passed in; no default service is injected.
 *
 * @example
 * ```typescript
 * const did = generateDidKey(publicKey);
 * const doc = generateDidDocument(did, publicKey, [], [
 *   { id: `${did}#hub`, type: "DIDCommMessaging", serviceEndpoint: "https://hub.example" },
 * ]);
 * ```
 */
export function generateDidDocument(
  did: string,
  publicKey: Uint8Array,
  additionalKeys: {
    id: string;
    publicKey: Uint8Array;
    type?: string;
    algorithm?: string;
    metadata?: Record<string, unknown>;
  }[] = [],
  additionalServices: Service[] = [],
  mainKeyMetadata?: Record<string, unknown>,
  mainKeyId?: string,
  keyAgreementPublicKey?: Uint8Array,
): DIDDocument {
  // Multicodec prefixes
  // Ed25519 (0xed) -> [0xed, 0x01]
  // P-256 (0x1200) -> [0x80, 0x24] (varint encoding of 0x1200 is 0x80 0x24)
  // Wait, P-256 multicodec is 0x1200. Varint of 0x1200:
  // 0x1200 = 4608
  // 4608 = 0x24 * 128 + 0x00
  // So [0x80, 0x24] is correct.
  const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);
  const P256_PREFIX = new Uint8Array([0x80, 0x24]);
  // X25519 multicodec is 0xec -> varint [0xec, 0x01].
  const X25519_PREFIX = new Uint8Array([0xec, 0x01]);
  const createVerificationMethod = (
    id: string,
    keyBytes: Uint8Array,
    type: string = "Ed25519VerificationKey2020",
    algorithm?: string,
    metadata?: Record<string, unknown>,
  ): VerificationMethod => {
    let prefix = ED25519_PREFIX;
    let methodType = type;

    if (algorithm === "ES256" || algorithm === "P256" || type === "JsonWebKey2020") {
      prefix = P256_PREFIX;
      methodType = "JsonWebKey2020";
    }

    if (!keyBytes || keyBytes.length === undefined) {
      throw new Error(`Invalid keyBytes for id ${id}: ${keyBytes ? typeof keyBytes : "undefined"}`);
    }
    const prefixedKey = new Uint8Array(prefix.length + keyBytes.length);
    prefixedKey.set(prefix);
    prefixedKey.set(keyBytes, prefix.length);
    const publicKeyMultibase = `z${base58.encode(prefixedKey)}`;

    let finalId = id;
    if (!id.includes("#") && mainKeyId && id === did) {
      finalId = `${id}#${mainKeyId}`;
    }

    return {
      id: finalId,
      type: methodType,
      controller: did,
      publicKeyMultibase,
      metadata,
    };
  };

  const mainMethod = createVerificationMethod(
    did,
    publicKey,
    "Ed25519VerificationKey2020",
    "EdDSA",
    mainKeyMetadata,
  );
  const verificationMethod: VerificationMethod[] = [mainMethod];
  const authentication: string[] = [mainMethod.id];
  const assertionMethod: string[] = [mainMethod.id];

  additionalKeys.forEach((key) => {
    const method = createVerificationMethod(
      key.id,
      key.publicKey,
      key.type,
      key.algorithm,
      key.metadata,
    );
    verificationMethod.push(method);
  });

  // An Ed25519 did:key identity implies an X25519 key-agreement key (the
  // birational Curve25519 twin of the signing key, per the did:key
  // method). Peers read it from `keyAgreement` to run ECDH and derive a
  // shared encryption key without any extra key exchange. An explicitly
  // supplied `keyAgreementPublicKey` replaces the derived twin: the seam
  // for identities whose agreement key lives elsewhere (e.g. a separate
  // non-extractable WebCrypto X25519 key).
  const keyAgreement: string[] = [];
  try {
    const x25519PublicKey = keyAgreementPublicKey ?? edwardsToX25519PublicKey(publicKey);
    const prefixedKey = new Uint8Array(X25519_PREFIX.length + x25519PublicKey.length);
    prefixedKey.set(X25519_PREFIX);
    prefixedKey.set(x25519PublicKey, X25519_PREFIX.length);
    const publicKeyMultibase = `z${base58.encode(prefixedKey)}`;
    const keyAgreementMethod: VerificationMethod = {
      id: `${did}#${publicKeyMultibase}`,
      type: "X25519KeyAgreementKey2020",
      controller: did,
      publicKeyMultibase,
    };
    verificationMethod.push(keyAgreementMethod);
    keyAgreement.push(keyAgreementMethod.id);
  } catch {
    // A key without an X25519 equivalent simply yields no keyAgreement.
  }

  const service: Service[] = [...additionalServices];

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
      "https://w3id.org/security/suites/x25519-2020/v1",
    ],
    id: did,
    verificationMethod,
    authentication,
    assertionMethod,
    ...(keyAgreement.length > 0 ? { keyAgreement } : {}),
    service,
  };
}

/**
 * Generate the did:key identifier from Ed25519 public key using base58btc encoding
 * @param publicKey - The raw Ed25519 public key bytes (32 bytes)
 * @returns The did:key identifier
 *
 * @example
 * ```typescript
 * const did = generateDidKey(publicKey); // "did:key:z6Mk..."
 * ```
 */
export function generateDidKey(publicKey: Uint8Array): string {
  // Ed25519 multicodec is 0xed
  // The varint encoding is 0xed01
  const multicodecPrefix = new Uint8Array([0xed, 0x01]);

  // Combine prefix + public key
  const prefixedKey = new Uint8Array(multicodecPrefix.length + publicKey.length);
  prefixedKey.set(multicodecPrefix);
  prefixedKey.set(publicKey, multicodecPrefix.length);

  // Encode to base58btc with 'z' prefix
  return `did:key:z${base58.encode(prefixedKey)}`;
}
