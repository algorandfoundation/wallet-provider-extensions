/**
 * Post-quantum (PQ) account addresses, as introduced by go-algorand v5's
 * native Falcon accounts (`data/basics/pq_address.go`).
 *
 * A PQ public key is far too large to BE the address the way an ed25519
 * public key is (a Falcon-1024 key is 1793 bytes), so the address is a
 * domain-separated digest of the key instead:
 *
 * ```
 * address = sha512_256("PQA" || scheme || salt || publicKey)
 * ```
 *
 * where `scheme` is the 2-byte PQ signature scheme identifier (`"f1"` for
 * Falcon-1024) and `salt` is a single byte. The **canonical** salt for a key
 * is the lowest value whose resulting address is PQ-compliant, i.e. does
 * NOT decode as an Edwards25519 curve point (go-algorand's
 * `Address.IsPQCompliant`), so a PQ address can never be mistaken for an
 * ed25519 public key. Verified against the known-answer vectors of
 * go-algorand v5's `TestPQAddressKnownAnswers`.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

/**
 * The 2-byte PQ scheme identifier for Falcon-1024 (`protocol.PQSchemeFalcon1024`).
 *
 * @example
 * ```typescript
 * const { address, salt } = canonicalPQAddress(falconPublicKey, PQ_SCHEME_FALCON1024);
 * ```
 */
export const PQ_SCHEME_FALCON1024 = "f1";

/** The domain-separation prefix of the PQ address hash (`protocol.PostQuantumAddress`). */
const PQ_ADDRESS_HASH_ID = "PQA";

/**
 * The result of {@link canonicalPQAddress}: the address bytes and their salt.
 *
 * @example
 * ```typescript
 * const pq: CanonicalPQAddress = canonicalPQAddress(falconPublicKey);
 * console.log(encodeAddress(pq.address), pq.salt);
 * ```
 */
export interface CanonicalPQAddress {
  /** The 32-byte PQ address digest. */
  address: Uint8Array;
  /** The canonical salt (0–255) baked into the address preimage. */
  salt: number;
}

/**
 * Computes the 32-byte PQ address for a public key under a given salt:
 * `sha512_256("PQA" || scheme || salt || publicKey)`, matching go-algorand v5's
 * `basics.PQAddress`.
 *
 * @param scheme - The 2-byte PQ scheme identifier (e.g. {@link PQ_SCHEME_FALCON1024}).
 * @param salt - The salt byte (0–255) of the address preimage.
 * @param publicKey - The raw PQ public key bytes.
 * @returns The 32-byte address digest.
 *
 * @example
 * ```typescript
 * const digest = pqAddress(PQ_SCHEME_FALCON1024, 0, falconPublicKey);
 * ```
 */
export function pqAddress(scheme: string, salt: number, publicKey: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(PQ_ADDRESS_HASH_ID + scheme);
  const preimage = new Uint8Array(head.length + 1 + publicKey.length);
  preimage.set(head, 0);
  preimage[head.length] = salt & 0xff;
  preimage.set(publicKey, head.length + 1);
  return sha512_256(preimage);
}

/**
 * Reports whether 32 bytes decode as an Edwards25519 curve point, following
 * the permissive `edwards25519.Point.SetBytes` decoding go-algorand's
 * `crypto.IsEdwards25519Point` uses (non-canonical encodings accepted, no
 * subgroup check); noble's ZIP-215 mode matches those rules.
 *
 * @param bytes - The 32 bytes to test.
 * @returns Whether the bytes decode as a curve point.
 *
 * @example
 * ```typescript
 * const isCompliant = !isEdwards25519Point(pqAddress(PQ_SCHEME_FALCON1024, 0, publicKey));
 * ```
 */
export function isEdwards25519Point(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives the canonical PQ address of a public key: the address under the
 * LOWEST salt that is PQ-compliant (not an Edwards25519 point), matching
 * go-algorand v5's `basics.CanonicalPQAddressSalt`. Deterministic per key,
 * so both parties of any exchange derive the same address.
 *
 * @param publicKey - The raw PQ public key bytes.
 * @param scheme - The 2-byte PQ scheme identifier. Defaults to Falcon-1024.
 * @returns The canonical {@link CanonicalPQAddress}.
 * @throws When no salt in 0–255 yields a compliant address (cryptographically
 *   unreachable: each digest is on-curve with probability ~1/2).
 *
 * @example
 * ```typescript
 * const { address, salt } = canonicalPQAddress(falconPublicKey);
 * console.log(encodeAddress(address)); // 58-character Algorand address
 * ```
 */
export function canonicalPQAddress(
  publicKey: Uint8Array,
  scheme: string = PQ_SCHEME_FALCON1024,
): CanonicalPQAddress {
  for (let salt = 0; salt <= 0xff; salt += 1) {
    const address = pqAddress(scheme, salt, publicKey);
    if (!isEdwards25519Point(address)) {
      return { address, salt };
    }
  }
  throw new Error("no PQ-compliant address salt found for the public key");
}
