import { MaterialAccessError } from "../errors.ts";
import {
  algorithmName,
  consumeParamMaterial,
  createKeyHandle,
  extendSubtle,
  isShimKey,
  toArrayBuffer,
} from "./shim.ts";

/** Algorithm identifier used to route operations to the BIP39 decorator. */
export const BIP39_ALGORITHM = "BIP39";

/** Default mnemonic entropy strength, in bits (a 24-word phrase). */
export const BIP39_DEFAULT_STRENGTH = 256;

/**
 * The subset of the BIP39 primitive that {@link withSubtleBIP39} needs.
 *
 * Mirrors the public surface of `@scure/bip39` so a platform can supply either
 * that library or a native binding, as long as the mnemonic encoding and the
 * PBKDF2 seed derivation are byte-compatible. Core only depends on the binding
 * *types*.
 *
 * There are two reversible encodings and one one-way derivation:
 *
 * - `entropy ⟷ mnemonic` — a reversible wordlist encoding
 *   ({@link entropyToMnemonic} / {@link mnemonicToEntropy}). Persisting the
 *   entropy therefore keeps the phrase fully recoverable/displayable.
 * - `mnemonic (+passphrase) → seed` — a one-way PBKDF2-HMAC-SHA512 derivation
 *   ({@link mnemonicToSeed}) producing the 64-byte seed downstream key
 *   derivation consumes.
 */
export interface BIP39Binding {
  /**
   * Generates a fresh mnemonic phrase for the given entropy `strength`.
   *
   * @param strength - Entropy strength in bits (128/160/192/224/256).
   * @returns A space-delimited mnemonic phrase.
   */
  generateMnemonic(strength?: number): string;

  /**
   * Encodes entropy bytes as a mnemonic phrase (reversible).
   *
   * @param entropy - The entropy bytes (16/20/24/28/32 bytes).
   * @returns The mnemonic phrase for that entropy.
   */
  entropyToMnemonic(entropy: Uint8Array): string;

  /**
   * Recovers the entropy bytes encoded by a mnemonic phrase.
   *
   * @param mnemonic - The mnemonic phrase.
   * @returns The entropy bytes.
   */
  mnemonicToEntropy(mnemonic: string): Uint8Array;

  /**
   * Derives the 64-byte seed from a mnemonic via PBKDF2-HMAC-SHA512.
   *
   * @param mnemonic - The mnemonic phrase.
   * @param passphrase - Optional passphrase mixed into the derivation.
   * @returns The 64-byte seed.
   */
  mnemonicToSeed(mnemonic: string, passphrase?: string): Promise<Uint8Array>;
}

/**
 * Parameters accepted for BIP39 (`"BIP39"`) operations.
 */
export interface BIP39Params {
  name: typeof BIP39_ALGORITHM;
  /** Entropy strength in bits for `generateKey`; defaults to {@link BIP39_DEFAULT_STRENGTH}. */
  strength?: number;
  /** Optional passphrase mixed into the seed derivation for `deriveBits`. */
  passphrase?: string;
  /**
   * The mnemonic entropy, injected just-in-time for `deriveBits`. It is only
   * reachable inside the operation call frame and never retained by the shim
   * (it is zero-filled as soon as the operation completes).
   */
  entropy?: BufferSource;
}

/**
 * Extends a host {@link SubtleCrypto} with BIP39 mnemonic-seed support,
 * delegating every other algorithm to the host untouched.
 *
 * BIP39 is a *seed source*, not a signing algorithm: it produces the seed bytes
 * that downstream key derivation (BIP32-Ed25519, standalone Ed25519, …)
 * consumes. Modelling it as a Subtle decorator unifies key birth so every key's
 * material is minted through the same read-once channel the other shims use.
 *
 * `generateKey` mints a fresh mnemonic and returns a handle that *transiently*
 * carries its **entropy** (not the derived seed), so the calling storage engine
 * can consume it once (via `consumeKeyMaterial`) and persist it encrypted at
 * rest. Persisting the entropy — rather than the one-way PBKDF2 seed — keeps the
 * mnemonic phrase fully recoverable for backup/restore. `deriveBits` converts a
 * just-in-time-injected `entropy` into the 64-byte seed and wipes the injected
 * entropy when the operation completes. `importKey`/`exportKey` throw
 * {@link MaterialAccessError} — material never moves *through* the public
 * surface after birth.
 *
 * @param host - The Subtle implementation to extend (e.g. `crypto.subtle`).
 * @param bip39 - The BIP39 primitive binding.
 * @returns A new `SubtleCrypto` that also understands `"BIP39"`.
 *
 * @example
 * ```typescript
 * const subtle = withSubtleBIP39(crypto.subtle, bip39);
 *
 * // The storage engine births the entropy, persists it, then records a seed.
 * const key = await subtle.generateKey({ name: "BIP39", strength: 256 }, false, ["deriveBits"]);
 * const entropy = consumeKeyMaterial(key, (m) => persist(m)); // encrypted at rest, then wiped
 *
 * // Later, derive the 64-byte seed by injecting the fetched entropy.
 * const seed = await subtle.deriveBits({ name: "BIP39", entropy }, key);
 * ```
 */
export function withSubtleBIP39(host: SubtleCrypto, bip39: BIP39Binding): SubtleCrypto {
  const generateKey = async (
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey> => {
    if (algorithmName(algo) !== BIP39_ALGORITHM) {
      return host.generateKey(algo as AlgorithmIdentifier, extractable, keyUsages);
    }
    // Mint a fresh mnemonic and persist its ENTROPY (not the one-way seed), so
    // the phrase stays recoverable. The entropy rides on the returned handle
    // (non-enumerable, symbol-keyed) purely so the storage engine can read it
    // once and persist it encrypted at rest.
    const params = typeof algo === "string" ? undefined : (algo as BIP39Params);
    const strength = params?.strength ?? BIP39_DEFAULT_STRENGTH;
    const mnemonic = bip39.generateMnemonic(strength);
    const entropy = bip39.mnemonicToEntropy(mnemonic);
    return createKeyHandle("private", { name: BIP39_ALGORITHM }, extractable, keyUsages, entropy);
  };

  const importKey = async (
    format: KeyFormat,
    keyData: BufferSource | JsonWebKey,
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== BIP39_ALGORITHM) {
      return host.importKey(
        format as "raw",
        keyData as BufferSource,
        algo as AlgorithmIdentifier,
        extractable,
        keyUsages,
      );
    }
    throw new MaterialAccessError(
      "BIP39 entropy is owned by a storage engine; importKey is not supported",
    );
  };

  const exportKey = async (
    format: KeyFormat,
    key: CryptoKey,
  ): Promise<ArrayBuffer | JsonWebKey> => {
    if (!isShimKey(key, BIP39_ALGORITHM)) {
      return host.exportKey(format as "raw", key);
    }
    throw new MaterialAccessError(
      "BIP39 entropy never leaves the storage engine; exportKey is not supported",
    );
  };

  const deriveBits = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    length?: number | null,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== BIP39_ALGORITHM) {
      return host.deriveBits(algo as AlgorithmIdentifier, baseKey, length as number);
    }
    const passphrase = typeof algo === "string" ? undefined : (algo as BIP39Params).passphrase;
    // The injected entropy is wiped as soon as the seed is derived.
    return consumeParamMaterial(algo, "entropy", async (entropy) => {
      const mnemonic = bip39.entropyToMnemonic(entropy);
      const seed = await bip39.mnemonicToSeed(mnemonic, passphrase);
      try {
        return toArrayBuffer(seed);
      } finally {
        seed.fill(0);
      }
    });
  };

  const deriveKey = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    derivedKeyType: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== BIP39_ALGORITHM) {
      return host.deriveKey(algo, baseKey, derivedKeyType, extractable, keyUsages);
    }
    // A BIP39 seed is raw private material, so a `deriveKey` that returned a
    // usable key object would leak it through the public surface. Callers take
    // the raw seed via `deriveBits` (into a storage engine) instead.
    throw new MaterialAccessError(
      "BIP39 produces raw seed material; use deriveBits into a storage engine, not deriveKey",
    );
  };

  return extendSubtle(host, {
    generateKey,
    importKey,
    exportKey,
    deriveBits,
    deriveKey,
  } as unknown as Partial<SubtleCrypto>);
}
