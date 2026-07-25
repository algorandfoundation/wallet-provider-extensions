import { InvalidKeyDataError, InvalidKeyFormatError, MaterialAccessError } from "../errors.ts";
import {
  algorithmName,
  consumeMaterial,
  consumeParamMaterial,
  createKeyHandle,
  extendSubtle,
  isShimKey,
  paramMaterial,
  toArrayBuffer,
  toBytes,
} from "./shim.ts";

/** Algorithm identifier used to route operations to the deterministic-P256 decorator. */
export const DP256_ALGORITHM = "Deterministic-P256";

/**
 * Default salt for the PBKDF2-HMAC-SHA512 derived-main-key step, matching the
 * canonical Liquid Auth / `@algorandfoundation/dp256` contract. Passkeys are
 * only reproducible across devices and native signers when every party uses the
 * same salt, so this default must not drift.
 */
export const DP256_DEFAULT_SALT: Uint8Array = new TextEncoder().encode("liquid");

/** Default PBKDF2 iteration count for the derived-main-key step. */
export const DP256_DEFAULT_ITERATIONS = 210_000;

/** Default derived-main-key length, in bytes (512 bits). */
export const DP256_DEFAULT_KEY_LENGTH_BYTES = 64;

/**
 * The subset of the deterministic-P256 primitive that {@link withSubtleDP256}
 * needs. Mirrors the public surface of `@algorandfoundation/dp256`'s
 * `DeterministicP256` class one-to-one, so a platform can supply either the
 * JS implementation or a native binding (e.g. the Kotlin/Swift signers) as long
 * as the derivation is byte-compatible.
 *
 * There are two derivation levels, and both must be reproduced identically by
 * every party that regenerates a passkey:
 *
 * 1. `genDerivedMainKey` — PBKDF2-HMAC-SHA512 over the entropy, producing the
 *    **derived main key** (the parent/root of the deterministic hierarchy). Run
 *    once per device; the result is what {@link withSubtleDP256.generateKey}
 *    persists.
 * 2. `genDomainSpecificKeyPair` — `SHA-512(mainKey ‖ origin ‖ userHandle ‖
 *    counter)[0..32]`, producing the domain-specific P-256 private scalar.
 */
export interface DP256Binding {
  /**
   * Derives the main key from entropy using PBKDF2-HMAC-SHA512.
   *
   * @param entropy - The entropy source (e.g. BIP39 entropy bytes).
   * @param salt - PBKDF2 salt; defaults to {@link DP256_DEFAULT_SALT}.
   * @param iterationCount - PBKDF2 iterations; defaults to {@link DP256_DEFAULT_ITERATIONS}.
   * @param keyLengthBytes - Derived key length in bytes; defaults to {@link DP256_DEFAULT_KEY_LENGTH_BYTES}.
   * @returns The derived main key.
   */
  genDerivedMainKey(
    entropy: Uint8Array,
    salt: Uint8Array,
    iterationCount: number,
    keyLengthBytes: number,
  ): Promise<Uint8Array>;

  /**
   * Derives the domain-specific P-256 private scalar from the main key and the
   * `{ origin, userHandle, counter }` domain descriptor.
   *
   * @param derivedMainKey - The main key from {@link genDerivedMainKey}.
   * @param origin - The service origin/domain.
   * @param userHandle - The user's unique identifier on that service.
   * @param counter - Optional counter for multiple passkeys per service; defaults to 0.
   * @returns The 32-byte P-256 private scalar.
   */
  genDomainSpecificKeyPair(
    derivedMainKey: Uint8Array,
    origin: string,
    userHandle: string,
    counter?: number,
  ): Promise<Uint8Array>;

  /**
   * Produces a compact (64-byte `r ‖ s`) ECDSA-P256 signature over `payload`.
   */
  signWithDomainSpecificKeyPair(privateKey: Uint8Array, payload: Uint8Array): Uint8Array;

  /**
   * Returns the raw P-256 public key coordinates (64 bytes, `X ‖ Y`, without the
   * `0x04` uncompressed-point prefix) for a private scalar.
   */
  getPurePKBytes(privateKey: Uint8Array): Uint8Array;
}

/**
 * Parameters accepted for deterministic-P256 (`Deterministic-P256`) operations.
 */
export interface DP256Params {
  name: typeof DP256_ALGORITHM;
  /** Service origin/domain; part of the domain descriptor for `sign`/`deriveKey`/`deriveBits`. */
  origin?: string;
  /** User identifier on the service; part of the domain descriptor. */
  userHandle?: string;
  /** Optional counter for multiple passkeys per service; defaults to 0. */
  counter?: number;
  /**
   * Entropy consumed by `generateKey` to derive the main key via
   * PBKDF2-HMAC-SHA512, so the hierarchy is recoverable from a mnemonic. Only
   * read by `generateKey`.
   */
  entropy?: BufferSource;
  /** PBKDF2 salt for `generateKey`; defaults to {@link DP256_DEFAULT_SALT}. */
  salt?: BufferSource;
  /** PBKDF2 iterations for `generateKey`; defaults to {@link DP256_DEFAULT_ITERATIONS}. */
  iterationCount?: number;
  /** Derived key length in bytes for `generateKey`; defaults to {@link DP256_DEFAULT_KEY_LENGTH_BYTES}. */
  keyLengthBytes?: number;
  /**
   * The derived main key, injected just-in-time for `sign`/`deriveBits`. It is
   * only reachable inside the operation call frame and never retained by the
   * shim (it is zero-filled as soon as the operation completes).
   */
  mainKey?: BufferSource;
  /** For `deriveBits`: return the private scalar instead of the public key. */
  isPrivate?: boolean;
  /**
   * The raw P-256 public key (64 bytes `X ‖ Y`, or 65 bytes with a leading
   * `0x04`), supplied for `verify`. Public material is not secret, so
   * verification needs no storage-engine unlock.
   */
  publicKey?: BufferSource;
}

function originOf(algo: AlgorithmIdentifier): string {
  const origin = typeof algo === "string" ? undefined : (algo as Partial<DP256Params>).origin;
  if (typeof origin !== "string") {
    throw new InvalidKeyFormatError("Deterministic-P256 operations require an origin");
  }
  return origin;
}

function userHandleOf(algo: AlgorithmIdentifier): string {
  const userHandle =
    typeof algo === "string" ? undefined : (algo as Partial<DP256Params>).userHandle;
  if (typeof userHandle !== "string") {
    throw new InvalidKeyFormatError("Deterministic-P256 operations require a userHandle");
  }
  return userHandle;
}

function counterOf(algo: AlgorithmIdentifier): number {
  const counter = typeof algo === "string" ? undefined : (algo as Partial<DP256Params>).counter;
  return counter ?? 0;
}

/**
 * Prepends the `0x04` uncompressed-point marker to a 64-byte `X ‖ Y` public key
 * so it can be imported via WebCrypto's `"raw"` EC key format, which expects the
 * full uncompressed point. Bytes already carrying the prefix pass through.
 */
function toUncompressedPoint(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 65 && publicKey[0] === 0x04) return publicKey;
  if (publicKey.length !== 64) {
    throw new InvalidKeyFormatError(
      `Deterministic-P256 public key must be 64 (X‖Y) or 65 (0x04‖X‖Y) bytes, got ${publicKey.length}`,
    );
  }
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(publicKey, 1);
  return point;
}

/**
 * Extends a host {@link SubtleCrypto} with deterministic-P256 (passkey) key
 * support, delegating every other algorithm to the host untouched.
 *
 * Deterministic-P256 is a two-level derivation, mirroring the XHD shim's shape:
 * a **derived main key** (`generateKey`, PBKDF2-HMAC-SHA512 over entropy) is the
 * parent, and **domain-specific keys** are derived from it along a
 * `{ origin, userHandle, counter }` descriptor (the analogue of a BIP44 path).
 * The child is an ordinary P-256 key, so `verify` uses the host's native ECDSA
 * once the public point is imported.
 *
 * `generateKey` mints the derived main key and returns a handle that
 * *transiently* carries it, so the calling storage engine can consume it once
 * (via `consumeKeyMaterial`) and persist it encrypted at rest. `deriveKey`
 * mints a material-free metadata handle recording only the domain descriptor: a
 * derived key is treated like an ordinary key whose main key is fetched and the
 * child re-derived at `sign` time. For `sign`/`deriveBits` the main key is
 * injected just-in-time via the `mainKey` parameter and wiped when the operation
 * completes, and `verify` reads only the (non-secret) `publicKey` parameter, so
 * decrypted material lives only inside the operation call frame.
 * `importKey`/`exportKey` throw {@link MaterialAccessError} — material never
 * moves *through* the public surface after birth.
 *
 * @param host - The Subtle implementation to extend (e.g. `crypto.subtle`). Its
 *   native ECDSA-P256 support is used for `verify`.
 * @param dp256 - The deterministic-P256 primitive binding.
 * @returns A new `SubtleCrypto` that also understands `"Deterministic-P256"`.
 *
 * @example
 * ```typescript
 * const subtle = withSubtleDP256(crypto.subtle, dp256);
 *
 * // The storage engine births the main key, persists it, then records a passkey.
 * const main = await subtle.generateKey({ name: "Deterministic-P256", entropy }, false, ["sign"]);
 * const mainKey = consumeKeyMaterial(main, (m) => persist(m)); // encrypted at rest, then wiped
 *
 * const descriptor = { origin: "https://example.com", userHandle: "user-123" };
 * const passkey = await subtle.deriveKey(
 *   { name: "Deterministic-P256", ...descriptor },
 *   main,
 *   { name: "Deterministic-P256" },
 *   false,
 *   ["sign"],
 * );
 *
 * // Signing re-derives the domain key from the fetched main key.
 * const sig = await subtle.sign({ name: "Deterministic-P256", ...descriptor, mainKey }, passkey, message);
 * ```
 */
export function withSubtleDP256(host: SubtleCrypto, dp256: DP256Binding): SubtleCrypto {
  const generateKey = async (
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.generateKey(algo as AlgorithmIdentifier, extractable, keyUsages);
    }
    // Derive the main key from entropy via PBKDF2 so the deterministic
    // hierarchy is recoverable from a mnemonic. The fresh main key rides on the
    // returned handle (non-enumerable, symbol-keyed) purely so the calling
    // storage engine can read it once and persist it encrypted at rest.
    const params = typeof algo === "string" ? undefined : (algo as DP256Params);
    const entropy = params?.entropy;
    if (!entropy) {
      throw new InvalidKeyDataError("Deterministic-P256 generateKey requires entropy");
    }
    const salt = params?.salt ? toBytes(params.salt) : DP256_DEFAULT_SALT;
    const iterationCount = params?.iterationCount ?? DP256_DEFAULT_ITERATIONS;
    const keyLengthBytes = params?.keyLengthBytes ?? DP256_DEFAULT_KEY_LENGTH_BYTES;
    // Derive the main key, then wipe the entropy: it is private material the
    // caller injected and must not linger in memory after birth.
    const mainKey = await consumeMaterial(toBytes(entropy), (e) =>
      dp256.genDerivedMainKey(e, salt, iterationCount, keyLengthBytes),
    );
    return createKeyHandle("private", { name: DP256_ALGORITHM }, extractable, keyUsages, mainKey);
  };

  const deriveKey = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    derivedKeyType: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.deriveKey(algo, baseKey, derivedKeyType, extractable, keyUsages);
    }
    // A derived key is pure metadata: it records the domain descriptor so the
    // storage engine can treat it like an ordinary key and re-derive the child
    // from the persisted main key at sign time. No material is produced here.
    const algorithm = {
      name: DP256_ALGORITHM,
      origin: originOf(algo),
      userHandle: userHandleOf(algo),
      counter: counterOf(algo),
    } as unknown as KeyAlgorithm;
    const type: KeyType = keyUsages.includes("sign") ? "private" : "public";
    return createKeyHandle(type, algorithm, extractable, keyUsages);
  };

  const importKey = async (
    format: KeyFormat,
    keyData: BufferSource | JsonWebKey,
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.importKey(
        format as "raw",
        keyData as BufferSource,
        algo as AlgorithmIdentifier,
        extractable,
        keyUsages,
      );
    }
    throw new MaterialAccessError(
      "Deterministic-P256 key material is owned by a storage engine; importKey is not supported",
    );
  };

  const exportKey = async (
    format: KeyFormat,
    key: CryptoKey,
  ): Promise<ArrayBuffer | JsonWebKey> => {
    if (!isShimKey(key, DP256_ALGORITHM)) {
      return host.exportKey(format as "raw", key);
    }
    throw new MaterialAccessError(
      "Deterministic-P256 key material never leaves the storage engine; exportKey is not supported",
    );
  };

  const deriveBits = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    _length?: number | null,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.deriveBits(algo as AlgorithmIdentifier, baseKey, _length as number);
    }
    const origin = originOf(algo);
    const userHandle = userHandleOf(algo);
    const counter = counterOf(algo);
    const isPrivate =
      typeof algo === "string" ? false : Boolean((algo as Partial<DP256Params>).isPrivate);
    // The injected main key is wiped as soon as the domain key is derived.
    return consumeParamMaterial(algo, "mainKey", async (mainKey) => {
      const scalar = await dp256.genDomainSpecificKeyPair(mainKey, origin, userHandle, counter);
      try {
        // By default expose the (non-secret) public key; the private scalar is
        // only returned when explicitly requested (into a storage engine).
        return toArrayBuffer(isPrivate ? scalar : dp256.getPurePKBytes(scalar));
      } finally {
        scalar.fill(0);
      }
    });
  };

  const sign = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.sign(algo, key, data);
    }
    const origin = originOf(algo);
    const userHandle = userHandleOf(algo);
    const counter = counterOf(algo);
    // ES256 signs the SHA-256 digest of the message, not the raw bytes. The
    // binding's signer treats its payload as the digest directly (it does not
    // prehash), so we hash here to keep `sign`/`verify` symmetric and to emit a
    // standard ES256 signature the host's ECDSA `verify` (and any relying party)
    // accepts. The message is not secret, so it is hashed outside the unlock.
    const digest = new Uint8Array(await host.digest("SHA-256", toArrayBuffer(toBytes(data))));
    // The injected main key is wiped as soon as signing completes.
    const signature = await consumeParamMaterial(algo, "mainKey", async (mainKey) => {
      const scalar = await dp256.genDomainSpecificKeyPair(mainKey, origin, userHandle, counter);
      try {
        return dp256.signWithDomainSpecificKeyPair(scalar, digest);
      } finally {
        // The re-derived domain private scalar is secret too; wipe it as soon
        // as the signature has been produced.
        scalar.fill(0);
      }
    });
    return toArrayBuffer(signature);
  };

  const verify = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean> => {
    if (algorithmName(algo) !== DP256_ALGORITHM) {
      return host.verify(algo, key, signature, data);
    }
    // The derived key is an ordinary P-256 key, so verification uses the host's
    // native ECDSA once the public point has been imported. It needs only the
    // (non-secret) public key, so no storage-engine unlock is required.
    const point = toUncompressedPoint(paramMaterial(algo, "publicKey"));
    const publicKey = await host.importKey(
      "raw",
      toArrayBuffer(point),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return host.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(toBytes(signature)),
      toArrayBuffer(toBytes(data)),
    );
  };

  return extendSubtle(host, {
    generateKey,
    deriveKey,
    importKey,
    exportKey,
    deriveBits,
    sign,
    verify,
  } as unknown as Partial<SubtleCrypto>);
}
