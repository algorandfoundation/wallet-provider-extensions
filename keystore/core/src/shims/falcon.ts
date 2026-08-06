import { InvalidKeyDataError, MaterialAccessError } from "../errors.ts";
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

/** Algorithm identifier used to route operations to the Falcon decorator. */
export const FALCON_ALGORITHM = "Falcon-1024";

/**
 * Parameters accepted for Falcon-1024 `sign`/`verify` calls.
 *
 * The shim never holds key material: the private key is injected just-in-time
 * for `sign` and the (non-secret) public key is supplied for `verify`.
 */
export interface FalconParams {
  name: typeof FALCON_ALGORITHM;
  /**
   * Seed used by `generateKey` to derive the keypair deterministically, so the
   * key is recoverable from a mnemonic.
   */
  seed?: BufferSource;
  /** Private key material, injected just-in-time for `sign`. */
  privateKey?: BufferSource;
  /** Public key, supplied for `verify`. */
  publicKey?: BufferSource;
}

/**
 * The subset of the Falcon-1024 primitive that {@link withSubtleFalcon1024}
 * needs. Mirrors the pure functions exported by `falcon-1024`.
 */
export interface Falcon1024Binding {
  /**
   * Generates a Falcon-1024 keypair, deterministically when a `seed` is given.
   */
  generateKey(seed?: Uint8Array): { publicKey: Uint8Array; privateKey: Uint8Array };

  /**
   * Produces a compressed (variable-length) Falcon-1024 signature.
   */
  signCompressed(privateKey: Uint8Array, message: Uint8Array): Uint8Array;

  /**
   * Verifies a compressed Falcon-1024 signature.
   */
  verifyCompressed(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): boolean;
}

/**
 * Extends a host {@link SubtleCrypto} with Falcon-1024 post-quantum signature
 * support, delegating every other algorithm to the host untouched.
 *
 * The decorator adds responsibilities for the `"Falcon-1024"` algorithm to
 * `sign` and `verify`; anything else passes straight through. Because it
 * neither reads globals nor mutates the host, it composes with other decorators
 * and can be used by any consumer that already has a `SubtleCrypto` instance.
 *
 * The shim never *holds* key material: `sign` receives the private key
 * just-in-time via {@link FalconParams.privateKey} and `verify` receives the
 * (non-secret) {@link FalconParams.publicKey}, so decrypted secrets only live
 * inside the operation call frame. `generateKey` is the one exception: it mints
 * a keypair and returns handles that *transiently* carry the fresh material so
 * the calling storage engine can consume it once (via `consumeKeyMaterial`) and
 * persist it encrypted at rest. `importKey` and `exportKey` still throw
 * {@link MaterialAccessError} — material never moves *through* the public
 * surface after birth. The `key` argument is an opaque metadata handle (see
 * `createKeyHandle`).
 *
 * @param host - The Subtle implementation to extend (e.g. `crypto.subtle`).
 * @param falcon - The Falcon-1024 primitive binding (e.g. the `falcon-1024` module).
 * @returns A new `SubtleCrypto` that also understands `"Falcon-1024"`.
 *
 * @example
 * ```typescript
 * import * as falcon from "falcon-1024";
 * const subtle = withSubtleFalcon1024(crypto.subtle, falcon);
 *
 * // A storage engine births the keypair, reads the fresh material to persist,
 * // then injects it per operation.
 * const { privateKey } = (await subtle.generateKey(
 *   { name: "Falcon-1024", seed },
 *   false,
 *   ["sign", "verify"],
 * )) as CryptoKeyPair;
 * // Persisted encrypted at rest, then wiped from memory when `use` returns.
 * const privMaterial = consumeKeyMaterial(privateKey, (m) => persist(m));
 *
 * const sig = await subtle.sign({ name: "Falcon-1024", privateKey: privMaterial }, privateKey, message);
 * const ok = await subtle.verify({ name: "Falcon-1024", publicKey }, privateKey, sig, message);
 * ```
 */
export function withSubtleFalcon1024(host: SubtleCrypto, falcon: Falcon1024Binding): SubtleCrypto {
  const generateKey = async (
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey> => {
    if (algorithmName(algo) !== FALCON_ALGORITHM) {
      return host.generateKey(algo as AlgorithmIdentifier, extractable as boolean, keyUsages);
    }
    // Mint the keypair deterministically from the supplied seed so it is
    // recoverable from a mnemonic. The fresh material rides on the returned
    // handles (non-enumerable, symbol-keyed) purely so the calling storage
    // engine can read it once and persist it encrypted at rest.
    const seed = typeof algo === "string" ? undefined : (algo as FalconParams).seed;
    if (!seed) {
      throw new InvalidKeyDataError("Falcon-1024 generateKey requires a seed");
    }
    // Derive the keypair from the seed, then wipe the seed: it is private
    // material the caller injected and must not linger in memory after birth.
    const pair = await consumeMaterial(toBytes(seed), (s) => falcon.generateKey(s));
    const algorithm: KeyAlgorithm = { name: FALCON_ALGORITHM };
    return {
      publicKey: createKeyHandle(
        "public",
        algorithm,
        true,
        keyUsages.filter((usage) => usage === "verify"),
        pair.publicKey,
      ),
      privateKey: createKeyHandle(
        "private",
        algorithm,
        extractable,
        keyUsages.filter((usage) => usage === "sign"),
        pair.privateKey,
      ),
    };
  };

  const importKey = async (
    format: KeyFormat,
    keyData: BufferSource | JsonWebKey,
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== FALCON_ALGORITHM) {
      return host.importKey(
        format as "raw",
        keyData as BufferSource,
        algo as AlgorithmIdentifier,
        extractable,
        keyUsages,
      );
    }
    throw new MaterialAccessError(
      "Falcon-1024 key material is owned by a storage engine; importKey is not supported",
    );
  };

  const exportKey = async (
    format: KeyFormat,
    key: CryptoKey,
  ): Promise<ArrayBuffer | JsonWebKey> => {
    if (!isShimKey(key, FALCON_ALGORITHM)) {
      return host.exportKey(format as "raw", key);
    }
    throw new MaterialAccessError(
      "Falcon-1024 key material never leaves the storage engine; exportKey is not supported",
    );
  };

  const sign = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== FALCON_ALGORITHM) {
      return host.sign(algo, key, data);
    }
    // The injected private key is wiped as soon as signing completes.
    const signature = await consumeParamMaterial(algo, "privateKey", (privateKey) =>
      falcon.signCompressed(privateKey, toBytes(data)),
    );
    return toArrayBuffer(signature);
  };

  const verify = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean> => {
    if (algorithmName(algo) !== FALCON_ALGORITHM) {
      return host.verify(algo, key, signature, data);
    }
    // WebCrypto's `verify` reports an invalid signature as `false`; the Falcon
    // binding throws instead, so translate that into the boolean contract.
    try {
      return falcon.verifyCompressed(
        paramMaterial(algo, "publicKey"),
        toBytes(signature),
        toBytes(data),
      );
    } catch {
      return false;
    }
  };

  return extendSubtle(host, {
    generateKey,
    importKey,
    exportKey,
    sign,
    verify,
  } as unknown as Partial<SubtleCrypto>);
}
