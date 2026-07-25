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

/**
 * BIP32 derivation variants understood by the XHD binding.
 *
 * - `Khovratovich` (32) — the original BIP32-Ed25519 amendment.
 * - `Peikert` (9) — Peikert's amendment, the keystore default.
 */
export const BIP32DerivationType = {
  Khovratovich: 32,
  Peikert: 9,
} as const;

/** Algorithm identifier used to route operations to the XHD decorator. */
export const XHD_ALGORITHM = "BIP32-Ed25519";

/**
 * The subset of the BIP32-Ed25519 primitive that {@link withSubtleXHD} needs.
 *
 * Mirrors the public surface of `@algorandfoundation/xhd-wallet-api`'s
 * `XHDWalletAPI` (plus its otherwise-private `rawSign`) so a platform can
 * supply any compatible binding.
 */
export interface XHDBinding {
  /**
   * Derives the 96-byte extended root key `(kL, kR, c)` from a seed.
   *
   * @param seed - The seed bytes (e.g. from a BIP39 mnemonic).
   * @returns The extended root key, 96 bytes.
   */
  fromSeed(seed: Uint8Array): Uint8Array;

  /**
   * Derives a child key from an extended root key along a BIP44 path.
   *
   * @param rootKey - Extended root key `(kL, kR, c)`, 96 bytes.
   * @param bip44Path - BIP44 path segments.
   * @param isPrivate - When true returns the extended private key, otherwise the public key.
   * @param derivationType - One of {@link BIP32DerivationType}.
   */
  deriveKey(
    rootKey: Uint8Array,
    bip44Path: number[],
    isPrivate: boolean,
    derivationType: number,
  ): Promise<Uint8Array>;

  /**
   * Signs raw data with the scalar derived from the root key at `bip44Path`.
   *
   * @param rootKey - Extended root key `(kL, kR, c)`, 96 bytes.
   * @param bip44Path - BIP44 path segments.
   * @param data - The message bytes to sign.
   * @param derivationType - One of {@link BIP32DerivationType}.
   * @returns A 64-byte Ed25519 signature.
   */
  rawSign(
    rootKey: Uint8Array,
    bip44Path: number[],
    data: Uint8Array,
    derivationType: number,
  ): Promise<Uint8Array>;

  /**
   * Verifies a standard Ed25519 signature against a 32-byte public key.
   */
  verifyWithPublicKey(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean>;

  /**
   * Performs Elliptic-Curve Diffie-Hellman against `otherPartyPub`, producing a
   * 32-byte shared secret between the child key at `bip44Path` and the remote
   * party. Used for the private-channel/negotiation (Diffie-Hellman) path.
   *
   * @param rootKey - Extended root key `(kL, kR, c)`, 96 bytes.
   * @param bip44Path - BIP44 path segments identifying the local child key.
   * @param otherPartyPub - The remote party's 32-byte public key.
   * @param meFirst - Whether the local key is ordered first in the derivation.
   * @param derivationType - One of {@link BIP32DerivationType}.
   * @returns The 32-byte shared secret.
   */
  ecdh(
    rootKey: Uint8Array,
    bip44Path: number[],
    otherPartyPub: Uint8Array,
    meFirst: boolean,
    derivationType: number,
  ): Promise<Uint8Array>;
}

/**
 * Parameters accepted for XHD (`BIP32-Ed25519`) `sign`/`deriveBits` calls.
 */
export interface XHDParams {
  name: typeof XHD_ALGORITHM;
  /** BIP44 path segments identifying the child key. */
  bip44Path: number[];
  /** Derivation variant; defaults to {@link BIP32DerivationType.Peikert}. */
  derivationType?: number;
  /** For `deriveBits`: derive the extended private key instead of the public key. */
  isPrivate?: boolean;
  /**
   * Seed used by `generateKey` to derive the extended root key, so the root is
   * recoverable from a mnemonic. Only read by `generateKey`.
   */
  seed?: BufferSource;
  /**
   * The 96-byte extended root key `(kL, kR, c)`, injected just-in-time for
   * `sign`/`deriveBits`. It is only reachable inside the operation call frame
   * and never retained by the shim.
   */
  rootKey?: BufferSource;
  /**
   * The 32-byte derived Ed25519 public key, supplied for `verify`. Public
   * material is not secret, so verification needs no storage-engine unlock.
   */
  publicKey?: BufferSource;
  /**
   * The remote party's 32-byte public key. When present on a `deriveBits`
   * call, the operation performs ECDH (shared-secret derivation) against the
   * injected `rootKey` instead of a child-key derivation.
   */
  otherPartyPub?: BufferSource;
  /** ECDH key ordering; defaults to `true` (local key first). */
  meFirst?: boolean;
}

function derivationOf(algo: AlgorithmIdentifier): number {
  const requested =
    typeof algo === "string" ? undefined : (algo as Partial<XHDParams>).derivationType;
  return requested ?? BIP32DerivationType.Peikert;
}

function pathOf(algo: AlgorithmIdentifier): number[] {
  const path = typeof algo === "string" ? undefined : (algo as Partial<XHDParams>).bip44Path;
  if (!path) {
    throw new InvalidKeyFormatError("BIP32-Ed25519 operations require a bip44Path");
  }
  return path;
}

/**
 * Extends a host {@link SubtleCrypto} with BIP32-Ed25519 (extended
 * hierarchical-deterministic) key support, delegating every other algorithm to
 * the host untouched.
 *
 * The decorator adds responsibilities for the `"BIP32-Ed25519"` algorithm to
 * `generateKey`, `deriveKey`, `deriveBits`, `sign` and `verify`; anything else
 * passes straight through. It reads no globals and does not mutate the host, so
 * it composes with other decorators and works for any consumer holding a
 * `SubtleCrypto` instance.
 *
 * A BIP32-Ed25519 private key is the 96-byte extended root key `(kL, kR, c)`.
 * `generateKey` derives that root from a `seed` and returns a handle that
 * *transiently* carries it, so the calling storage engine can consume it once
 * (via `consumeKeyMaterial`) and persist it encrypted at rest. `deriveKey`
 * mints a material-free metadata handle that merely records the child's `bip44Path`
 * (and `derivationType`): a derived key is treated like an ordinary key whose
 * associated root is fetched and re-derived at `sign` time. For `sign` and
 * `deriveBits` the root is injected just-in-time via the `rootKey` parameter,
 * and `verify` reads only the (non-secret) `publicKey` parameter, so decrypted
 * material lives only inside the operation call frame. `importKey`/`exportKey`
 * throw {@link MaterialAccessError} — material never moves *through* the public
 * surface after birth. The `key` argument is an opaque metadata handle (see
 * `createKeyHandle`).
 *
 * @param host - The Subtle implementation to extend (e.g. `crypto.subtle`).
 * @param xhd - The BIP32-Ed25519 primitive binding.
 * @returns A new `SubtleCrypto` that also understands `"BIP32-Ed25519"`.
 *
 * @example
 * ```typescript
 * const subtle = withSubtleXHD(crypto.subtle, xhd);
 *
 * // The storage engine births the root, persists it, then records a derived key.
 * const root = await subtle.generateKey({ name: "BIP32-Ed25519", seed }, false, ["sign"]);
 * const rootKey = consumeKeyMaterial(root, (m) => persist(m)); // encrypted at rest, then wiped
 *
 * const path = [harden(44), harden(283), harden(0), 0, 0];
 * const account = await subtle.deriveKey({ name: "BIP32-Ed25519", bip44Path: path }, root, { name: "BIP32-Ed25519" }, false, ["sign"]);
 *
 * // Signing re-derives from the fetched root along the recorded path.
 * const sig = await subtle.sign({ name: "BIP32-Ed25519", bip44Path: path, rootKey }, account, message);
 * ```
 */
export function withSubtleXHD(host: SubtleCrypto, xhd: XHDBinding): SubtleCrypto {
  const generateKey = async (
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.generateKey(algo as AlgorithmIdentifier, extractable, keyUsages);
    }
    // Derive the extended root key from the seed so it is recoverable from a
    // mnemonic. The fresh root rides on the returned handle (non-enumerable,
    // symbol-keyed) purely so the calling storage engine can read it once and
    // persist it encrypted at rest.
    const seed = typeof algo === "string" ? undefined : (algo as XHDParams).seed;
    if (!seed) {
      throw new InvalidKeyDataError("BIP32-Ed25519 generateKey requires a seed");
    }
    // Derive the root from the seed, then wipe the seed: it is private material
    // the caller injected and must not linger in memory after birth.
    const rootKey = await consumeMaterial(toBytes(seed), (s) => xhd.fromSeed(s));
    return createKeyHandle("private", { name: XHD_ALGORITHM }, extractable, keyUsages, rootKey);
  };

  const deriveKey = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    derivedKeyType: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.deriveKey(algo, baseKey, derivedKeyType, extractable, keyUsages);
    }
    // A derived key is pure metadata: it records the child's path (and
    // derivation variant) so the storage engine can treat it like an ordinary
    // key and re-derive the child from the persisted root at sign time. No
    // material is produced or handed out here.
    const derivationType = derivationOf(algo);
    const bip44Path = pathOf(algo);
    const type: KeyType = keyUsages.includes("sign") ? "private" : "public";
    const algorithm = { name: XHD_ALGORITHM, bip44Path, derivationType } as KeyAlgorithm;
    return createKeyHandle(type, algorithm, extractable, keyUsages);
  };

  const importKey = async (
    format: KeyFormat,
    keyData: BufferSource | JsonWebKey,
    algo: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.importKey(
        format as "raw",
        keyData as BufferSource,
        algo as AlgorithmIdentifier,
        extractable,
        keyUsages,
      );
    }
    throw new MaterialAccessError(
      "BIP32-Ed25519 key material is owned by a storage engine; importKey is not supported",
    );
  };

  const exportKey = async (
    format: KeyFormat,
    key: CryptoKey,
  ): Promise<ArrayBuffer | JsonWebKey> => {
    if (!isShimKey(key, XHD_ALGORITHM)) {
      return host.exportKey(format as "raw", key);
    }
    throw new MaterialAccessError(
      "BIP32-Ed25519 key material never leaves the storage engine; exportKey is not supported",
    );
  };

  const deriveBits = async (
    algo: AlgorithmIdentifier,
    baseKey: CryptoKey,
    length?: number | null,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.deriveBits(algo as AlgorithmIdentifier, baseKey, length as number);
    }
    // When a remote public key is present the caller is requesting an ECDH
    // shared secret (the Diffie-Hellman negotiation path) rather than a child
    // key derivation.
    const otherPartyPub =
      typeof algo === "string" ? undefined : (algo as Partial<XHDParams>).otherPartyPub;
    if (otherPartyPub !== undefined) {
      const meFirst =
        typeof algo === "string" ? true : ((algo as Partial<XHDParams>).meFirst ?? true);
      // The injected root key is wiped as soon as the shared secret is derived.
      const secret = await consumeParamMaterial(algo, "rootKey", (rootKey) =>
        xhd.ecdh(rootKey, pathOf(algo), toBytes(otherPartyPub), meFirst, derivationOf(algo)),
      );
      return toArrayBuffer(secret);
    }
    const isPrivate =
      typeof algo === "string" ? false : Boolean((algo as Partial<XHDParams>).isPrivate);
    // The injected root key is wiped as soon as derivation completes.
    const derived = await consumeParamMaterial(algo, "rootKey", (rootKey) =>
      xhd.deriveKey(rootKey, pathOf(algo), isPrivate, derivationOf(algo)),
    );
    const bits = typeof length === "number" ? derived.subarray(0, length / 8) : derived;
    return toArrayBuffer(bits);
  };

  const sign = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.sign(algo, key, data);
    }
    // The injected root key is wiped as soon as signing completes.
    const signature = await consumeParamMaterial(algo, "rootKey", (rootKey) =>
      xhd.rawSign(rootKey, pathOf(algo), toBytes(data), derivationOf(algo)),
    );
    return toArrayBuffer(signature);
  };

  const verify = async (
    algo: AlgorithmIdentifier,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean> => {
    if (algorithmName(algo) !== XHD_ALGORITHM) {
      return host.verify(algo, key, signature, data);
    }
    return xhd.verifyWithPublicKey(
      toBytes(signature),
      toBytes(data),
      paramMaterial(algo, "publicKey"),
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
