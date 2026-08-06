/**
 * The shared, platform-neutral keystore orchestrator.
 *
 * {@link createKeyStore} implements the {@link KeyStoreAPI} on top of two
 * injected seams and nothing else:
 *
 * - a **host {@link SubtleCrypto}** (plus an optional array of composable
 *   {@link SubtleShim} decorators layered over it), which performs all
 *   cryptography, and
 * - a **{@link KeyStoreDriver}**, which owns encrypted-at-rest persistence of
 *   material and metadata plus any platform-specific unlock flow.
 *
 * The orchestrator itself is crypto-only: it fetches + decrypts material
 * just-in-time via {@link KeyStoreDriver.use}, injects it into the shim
 * algorithm parameters for a single operation, and mirrors only UI-safe
 * metadata into the reactive {@link KeyStoreState} store. This is the body that
 * used to live inside the browser engine; every backend now supplies a driver
 * instead of copying it.
 */

import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import { DEFAULT_HOST_ALGORITHMS } from "./constants.ts";
import { createDefaultShims } from "./defaults.ts";
import { InvalidKeyDataError, InvalidKeyFormatError, KeyNotFoundError } from "./errors.ts";
import {
  BIP32DerivationType,
  consumeKeyMaterial,
  createKeyHandle,
  type SubtleShim,
} from "./shims/index.ts";
import type { KeyStoreAPI } from "./types/backend.ts";
import type {
  DeriveOptions,
  ExportOptions,
  GenerateOptions,
  Key,
  KeyData,
  KeyFormat,
  KeyId,
  KeyOptions,
} from "./types/core.ts";
import type { KeyStoreDriver } from "./types/driver.ts";
import type { KeyStoreCapability, KeyStoreState } from "./types/extension.ts";

/**
 * Options for {@link createKeyStore}.
 *
 * @typeParam Ctx - The driver's per-operation context, threaded through the
 *   returned {@link KeyStoreAPI}.
 */
export interface CreateKeyStoreOptions<Ctx = unknown> {
  /** The storage backend that persists material + metadata for this keystore. */
  driver: KeyStoreDriver<Ctx>;
  /** Reactive store mirroring the persisted metadata (never private material). */
  store: Store<KeyStoreState>;
  /** Host Subtle implementation (never a shim); defaults to `globalThis.crypto.subtle`. */
  subtle?: SubtleCrypto;
  /**
   * Composable Subtle decorators layered over the host, in order, so a single
   * Subtle understands the extra algorithms the keystore needs (BIP32-Ed25519,
   * Falcon-1024, Deterministic-P256, BIP39/Algo25 seeds, …). Each entry is a
   * `withSubtle*` shim with its primitive binding already applied, e.g.
   * `(host) => withSubtleXHD(host, xhd)`. Unknown algorithms fall straight
   * through to the host, and an operation that needs a shim which was not
   * supplied surfaces the host's own "unsupported algorithm" error. Injected
   * this way, core never depends on any specific `xhd`/`falcon`/… binding.
   *
   * Defaults to {@link createDefaultShims} — every supported algorithm add-on
   * (BIP32-Ed25519, Falcon-1024, Deterministic-P256, BIP39 and Algo25) enabled
   * with its bundled binding. Pass an explicit array (including `[]`) to
   * override this and supply your own/platform-native bindings.
   *
   * May also be a (possibly async) factory, resolved once as part of
   * {@link KeyStore.ready}. This lets a synchronous platform engine defer
   * building its default stack — e.g. React Native asynchronously loads its
   * native `@joe-p/react-native-falcon` binding and folds it into
   * {@link createDefaultShims} — without blocking construction.
   */
  shims?: SubtleShim[] | (() => SubtleShim[] | Promise<SubtleShim[]>);
  /**
   * Optional hook collection applied at creation. When provided, every
   * material-touching {@link KeyStoreAPI} method is wrapped so `before`/`after`
   * hooks can intercept, observe or short-circuit the operation, and the
   * collection is exposed as {@link KeyStore.hooks}. This is how the Wallet
   * Provider extension threads its hooks into the engine — the hooks are bound
   * once, when the keystore is created, rather than per call site.
   */
  hooks?: HookCollection<any>;
  /**
   * The standard algorithms the host {@link SubtleCrypto} is expected to
   * provide, reported (tagged `source: "host"`) alongside the active shim
   * add-ons in {@link KeyStoreState.algorithms}. Defaults to
   * {@link DEFAULT_HOST_ALGORITHMS}. WebCrypto cannot be enumerated, so this is
   * a documented baseline a platform can override to match its host (e.g. a
   * React Native Subtle polyfill lacking `Ed25519`).
   */
  hostAlgorithms?: readonly string[];
}

/**
 * A {@link KeyStoreAPI} plus a `ready` promise that resolves once the driver is
 * open and the reactive store has been hydrated from persisted metadata.
 *
 * @typeParam Ctx - The driver's per-operation context.
 */
export interface KeyStore<Ctx = unknown> extends KeyStoreAPI<Ctx> {
  /** Resolves once the driver is ready and existing metadata is loaded. */
  ready: Promise<void>;
  /**
   * The hook collection bound at creation, when {@link CreateKeyStoreOptions.hooks}
   * was supplied. Consumers register `before`/`after`/`error` hooks against
   * operation ids (`"generate"`, `"sign"`, `"verify"`, `"remove"`, `"clear"`,
   * `"deriveFromSeed"`, `"encryptWithKey"`, `"decryptWithKey"`,
   * `"deriveSharedSecret"`, `"batchSign"`, …).
   */
  hooks?: HookCollection<any>;
}

/**
 * Casts a `Uint8Array` to the strict `BufferSource` overload WebCrypto expects.
 * The primitive libraries and decrypted buffers are `Uint8Array<ArrayBufferLike>`,
 * which the DOM lib's `ArrayBuffer`-parameterised `BufferSource` rejects.
 */
function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * The fixed 16-byte PKCS#8 DER prefix for an Ed25519 private key (RFC 8410):
 * `SEQUENCE { version 0, AlgorithmIdentifier { id-Ed25519 }, PrivateKey OCTET
 * STRING(OCTET STRING(seed)) }`. Concatenated with the 32-byte seed, it yields
 * a complete 48-byte PKCS#8 document the host Subtle can import.
 */
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/** Wraps a 32-byte Ed25519 seed into a complete PKCS#8 DER document. */
function seedToEd25519Pkcs8(seed: Uint8Array): Uint8Array {
  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.byteLength + seed.byteLength);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.byteLength);
  return pkcs8;
}

/** Decodes an unpadded base64url string (as used by JWK members) into bytes. */
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when `a` and `b` hold the same bytes. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The generation inputs THIS engine consumes as secrets. Metadata is stored in
 * PLAINTEXT — mirrored into the reactive store, pushed over RPC and persisted
 * unencrypted (IndexedDB metadata store, the MMKV `k/` bucket, Node's metadata
 * file) — so these are dropped before the rest of `params` is recorded.
 *
 * Deliberately limited to what the engine itself reads: an inline `seed` or
 * `entropy`, the BIP39 `passphrase` and the PBKDF2 `salt`. Existing key
 * material belongs in {@link KeyStoreAPI.import} / {@link
 * KeyStoreAPI.importSeed} and is referenced by `parentKeyId` afterwards, and
 * anything else a caller chooses to put in `params` is THEIR metadata: the
 * engine records it verbatim rather than guessing at names like `password` or
 * `secret`.
 */
const SECRET_PARAM_KEYS: readonly string[] = ["seed", "entropy", "passphrase", "salt"];

/**
 * Strips every {@link SECRET_PARAM_KEYS} member from a `params` bag, yielding
 * the subset that is safe to persist as plaintext metadata. Always use this
 * instead of spreading `options.params` straight into a metadata record.
 */
function publicParams(params?: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (SECRET_PARAM_KEYS.includes(name)) continue;
    safe[name] = value;
  }
  return safe;
}

/** Parses a BIP44 path string (e.g. `"m/44'/283'/0'/0/0"`) into segments. */
function parsePath(path: string): number[] {
  return path
    .replace(/^m\/?/, "")
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => {
      const hardened = part.endsWith("'") || part.endsWith("h");
      const index = Number.parseInt(part.replace(/['h]$/, ""), 10);
      if (Number.isNaN(index)) {
        throw new InvalidKeyFormatError(`invalid BIP44 path segment: ${part}`);
      }
      return hardened ? index + 0x80_00_00_00 : index;
    });
}

/**
 * Suffix of the secret-store id holding a mnemonic seed's sealed passphrase
 * (the BIP39 "25th word"), used when a seed is generated with
 * `params.storePassphrase`. The owning seed records the resulting id under
 * `metadata.passphraseSecretId`; the secret itself is an ordinary secret-store
 * entry, so it can be read, listed and removed like any other secret.
 */
const PASSPHRASE_SECRET_SUFFIX = ".passphrase";

/** Version byte prefixing {@link KeyStoreAPI.encryptWithKey} ciphertext. */
const ENCRYPT_VERSION = 1;
/** HKDF `info` binding the derived AES key to this keystore's encrypt scheme. */
const ENCRYPT_INFO = new TextEncoder().encode("keystore-encrypt-v1");

/**
 * Derives a deterministic AES-GCM key from a key's **public** bytes via the host
 * Subtle (HKDF over the public key). Because the derivation depends only on the
 * public key, `encryptWithKey`/`decryptWithKey` need no private-material unlock —
 * exactly like the original backend, which keyed a symmetric cipher off a hash
 * of the public key. Here it is standardized on Subtle HKDF + AES-GCM.
 */
async function deriveAesKeyFromPublic(
  host: SubtleCrypto,
  publicKey: Uint8Array,
): Promise<CryptoKey> {
  const base = await host.importKey("raw", publicKey as unknown as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return host.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: ENCRYPT_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Creates a keystore that fulfils the {@link KeyStoreAPI} by orchestrating an
 * injected host {@link SubtleCrypto} (with any composable {@link SubtleShim}
 * decorators layered over it for BIP32-Ed25519 / Falcon-1024 / …) and an
 * injected {@link KeyStoreDriver} for persistence.
 *
 * Standard host keys (Ed25519, ECDSA, AES, …) are persisted as non-extractable
 * {@link CryptoKey}s when the driver supports it
 * ({@link DriverCapabilities.nativeCryptoKey}), otherwise serialized to sealed
 * bytes. Shim keys (BIP32-Ed25519 roots, Falcon private keys) and raw seeds are
 * always stored as bytes the driver encrypts at rest. Secret material is
 * decrypted just-in-time inside {@link KeyStoreDriver.use}, injected into the
 * shim algorithm parameters and wiped once the operation completes. The
 * reactive `store` mirrors only UI-safe metadata.
 *
 * @typeParam Ctx - The driver's per-operation context, threaded verbatim
 *   through the returned API's material-touching methods.
 * @param options - {@link CreateKeyStoreOptions}.
 * @returns A {@link KeyStore} (a `KeyStoreAPI` plus a `ready` promise).
 *
 * @example
 * ```typescript
 * const keystore = createKeyStore({
 *   driver,
 *   store,
 *   shims: [(host) => withSubtleXHD(host, xhd), (host) => withSubtleFalcon1024(host, falcon)],
 * });
 * await keystore.ready;
 * const id = await keystore.generate({
 *   type: "ed25519",
 *   algorithm: "EdDSA",
 *   extractable: false,
 *   keyUsages: ["sign", "verify"],
 * });
 * const signature = await keystore.sign(id, new TextEncoder().encode("hi"));
 * ```
 */
export function createKeyStore<Ctx = unknown>(options: CreateKeyStoreOptions<Ctx>): KeyStore<Ctx> {
  const { driver, store } = options;
  const host = options.subtle ?? globalThis.crypto.subtle;
  const native = driver.capabilities.nativeCryptoKey;

  // Layer the composable shims over the host, in order, so a single Subtle
  // understands the extra algorithms; unknown algorithms fall straight through
  // to the host, and an operation needing a shim that was not supplied surfaces
  // the host's own "unsupported algorithm" error.
  //
  // The default shim stack ({@link createDefaultShims}) loads its optional
  // crypto libraries lazily, so resolving it is async. It is folded into the
  // `ready` promise; every material-touching method `await ready` before it
  // touches `subtle`, so the stack is always fully layered by then.
  let subtle = host;

  const ready = (async (): Promise<void> => {
    const shimsOption = options.shims;
    const shims =
      shimsOption === undefined
        ? await createDefaultShims()
        : typeof shimsOption === "function"
          ? await shimsOption()
          : shimsOption;
    for (const shim of shims) subtle = shim(subtle);
    await driver.ready;
    const keys = (await driver.listMeta()).filter(Boolean);
    // Surface the keystore's cryptographic capabilities from the reactive state,
    // each tagged with its source: the standard host algorithms (a documented
    // baseline, since WebCrypto is not enumerable) plus the composable shim
    // add-ons that are actually active (each shim carries its `algorithm` when
    // tagged via `tagShim`).
    const hostAlgorithms = options.hostAlgorithms ?? DEFAULT_HOST_ALGORITHMS;
    const algorithms: KeyStoreCapability[] = [
      ...hostAlgorithms.map((algorithm) => ({ algorithm, source: "host" as const })),
      ...shims
        .map((shim) => shim.algorithm)
        .filter((name): name is string => typeof name === "string")
        .map((algorithm) => ({ algorithm, source: "shim" as const })),
    ];
    store.setState(() => ({ keys, status: "idle", algorithms }));
  })();

  const setStatus = (status: string): void => {
    store.setState((s) => ({ ...s, status }));
  };

  const addMetadata = async (key: Key): Promise<void> => {
    await driver.putMeta(key);
    store.setState((s) => ({ ...s, keys: [key, ...s.keys.filter((k) => k.id !== key.id)] }));
  };

  const loadMetadata = async (id: KeyId): Promise<Key> => {
    const inMemory = store.state.keys.find((k) => k.id === id);
    if (inMemory) return inMemory;
    const persisted = await driver.getMeta(id);
    if (!persisted) throw new KeyNotFoundError(id);
    return persisted;
  };

  /** The mnemonic seed schemes stored as recoverable entropy (see `withSubtleBIP39`). */
  const isMnemonicScheme = (scheme: unknown): scheme is "bip39" | "algo25" =>
    scheme === "bip39" || scheme === "algo25";

  /**
   * Converts a mnemonic scheme's stored **entropy** into the actual derivation
   * **seed** via the corresponding seed shim (`entropy → seed`). For `bip39`
   * this runs PBKDF2 (16/32 → 64 bytes); for `algo25` the entropy already is the
   * 32-byte seed. The injected `entropy` buffer is wiped by the shim.
   */
  const seedFromMnemonicEntropy = async (
    scheme: "bip39" | "algo25",
    entropy: Uint8Array,
    passphrase?: string,
  ): Promise<Uint8Array> => {
    const name = scheme === "algo25" ? "Algo25" : "BIP39";
    const handle = createKeyHandle("private", { name }, false, ["deriveBits"]);
    return new Uint8Array(
      (await subtle.deriveBits(
        { name, entropy, passphrase } as unknown as AlgorithmIdentifier,
        handle,
      )) as ArrayBuffer,
    );
  };

  /** Persists secret bytes for `id`; the driver seals them at rest. */
  const putBytes = (id: KeyId, bytes: Uint8Array, ctx?: Ctx): Promise<void> =>
    driver.put(id, { kind: "bytes", bytes }, ctx);

  /**
   * Runs `fn` with the seed bytes for a generation, sourced either inline
   * (`params.seed`) or by resolving a parent seed id through the driver.
   *
   * When the resolved parent is a mnemonic seed (its metadata carries
   * `scheme: "bip39" | "algo25"`) and `opts.wantSeed` is true (the default), the
   * stored **entropy** is first converted to the derivation **seed** via the
   * seed shim. Consumers that instead want the raw stored bytes (e.g. the dp256
   * main key, which PBKDF2s the entropy itself) pass `wantSeed: false`. Legacy
   * seeds (no scheme) are always passed through unchanged.
   */
  const withSeed = async <T>(
    params: Record<string, unknown> | undefined,
    ctx: Ctx | undefined,
    fn: (seed: Uint8Array) => Promise<T>,
    opts: { wantSeed?: boolean } = {},
  ): Promise<T> => {
    const wantSeed = opts.wantSeed ?? true;
    if (params?.seed instanceof Uint8Array) {
      const seed = Uint8Array.from(params.seed);
      try {
        return await fn(seed);
      } finally {
        seed.fill(0);
      }
    }
    if (typeof params?.parentKeyId === "string") {
      const parentKeyId = params.parentKeyId;
      const parentMeta = await loadMetadata(parentKeyId);
      const scheme = parentMeta.metadata?.scheme;
      // An explicit `params.passphrase` always wins; otherwise fall back to the
      // one sealed with the seed (opt-in, see `putPassphraseSecret`). Resolved
      // BEFORE unlocking the parent so the two `driver.use` calls never nest.
      const passphrase =
        (params.passphrase as string | undefined) ??
        (wantSeed && isMnemonicScheme(scheme)
          ? await readPassphraseSecret(parentMeta, ctx)
          : undefined);
      return driver.use(parentKeyId, ctx, async (m) => {
        if (m.kind !== "bytes") {
          throw new InvalidKeyDataError(`parent ${parentKeyId} does not hold seed bytes`);
        }
        if (wantSeed && isMnemonicScheme(scheme)) {
          const seed = await seedFromMnemonicEntropy(scheme, m.bytes, passphrase);
          try {
            return await fn(seed);
          } finally {
            seed.fill(0);
          }
        }
        return fn(m.bytes);
      });
    }
    throw new InvalidKeyDataError("a seed (params.seed) or params.parentKeyId is required");
  };

  /**
   * Seals `passphrase` under `secretId` as an ordinary secret-store entry and
   * records which seed it belongs to. Only ever called for a seed generated
   * with `params.storePassphrase: true`.
   */
  const putPassphraseSecret = async (
    secretId: KeyId,
    seedId: KeyId,
    passphrase: string,
    ctx?: Ctx,
  ): Promise<void> => {
    const bytes = new TextEncoder().encode(passphrase);
    try {
      await putBytes(secretId, bytes, ctx);
    } finally {
      bytes.fill(0);
    }
    await addMetadata({
      id: secretId,
      type: "secret-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: [],
      metadata: { storage: "bytes", name: "Seed passphrase", passphraseFor: seedId },
      version: 1,
    });
  };

  /**
   * Reads the passphrase sealed with `seedMeta`, or `undefined` when the seed
   * has none. A recorded-but-unreadable secret THROWS rather than deriving
   * without it: silently dropping the passphrase would mint a different (and
   * wrong) key from the same entropy.
   */
  const readPassphraseSecret = async (seedMeta: Key, ctx?: Ctx): Promise<string | undefined> => {
    const secretId = seedMeta.metadata?.passphraseSecretId;
    if (typeof secretId !== "string") return undefined;
    return driver.use(secretId, ctx, (m) => {
      if (m.kind !== "bytes") {
        throw new InvalidKeyDataError(`secret ${secretId} does not hold bytes`);
      }
      return new TextDecoder().decode(m.bytes);
    });
  };

  /**
   * Generates a fresh mnemonic **seed** (`type: "seed"`) via the BIP39 or Algo25
   * shim. Only the recoverable **entropy** is persisted (sealed at rest) —
   * `metadata.scheme` records which mnemonic scheme it belongs to so the phrase
   * can be reconstructed and downstream derivation can convert entropy → seed
   * just-in-time. The scheme is taken from `params.scheme`, else inferred from
   * `algorithm` (`"Algo25"` ⇒ `algo25`, otherwise `bip39`).
   *
   * A `params.passphrase` (the BIP39 "25th word") is NOT persisted by default —
   * `metadata.protected` merely records that one is required, and every later
   * derivation must supply it again. Passing `params.storePassphrase: true`
   * opts into sealing it in the secret store next to the seed (the id is
   * recorded as `metadata.passphraseSecretId`), after which {@link withSeed}
   * resolves it automatically. That is a deliberate trade-off: it keeps the
   * 25th word on the device, where it is only as safe as the driver's
   * encryption at rest.
   */
  const generateSeed = async (options: GenerateOptions, id: KeyId, ctx?: Ctx): Promise<KeyId> => {
    const scheme: "bip39" | "algo25" = isMnemonicScheme(options.params?.scheme)
      ? options.params.scheme
      : options.algorithm === "Algo25"
        ? "algo25"
        : "bip39";
    const name = scheme === "algo25" ? "Algo25" : "BIP39";
    const strength = options.params?.strength as number | undefined;
    const passphrase = options.params?.passphrase as string | undefined;
    // Never persist secrets/config into (plaintext) metadata.
    const safeParams = publicParams(options.params);
    const key = (await subtle.generateKey(
      { name, strength } as unknown as AlgorithmIdentifier,
      false,
      ["deriveBits", "deriveKey"],
    )) as CryptoKey;
    // Capture the just-born entropy once and persist it encrypted at rest.
    await consumeKeyMaterial(key, (m) => putBytes(id, Uint8Array.from(m), ctx));
    // Opt-in only: seal the passphrase beside the entropy so later derivations
    // resolve it without asking again.
    const passphraseSecretId =
      passphrase !== undefined && options.params?.storePassphrase === true
        ? `${id}${PASSPHRASE_SECRET_SUFFIX}`
        : undefined;
    if (passphraseSecretId !== undefined) {
      await putPassphraseSecret(passphraseSecretId, id, passphrase as string, ctx);
    }
    await addMetadata({
      id,
      type: "seed",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      // A BIP39 passphrase (the "25th word") is never stored in metadata;
      // `protected` merely records that one is required to reconstruct the seed
      // from the entropy, and `passphraseSecretId` points at the sealed copy
      // when the caller opted into storing it.
      metadata: {
        storage: "bytes",
        scheme,
        protected: passphrase ? true : undefined,
        passphraseSecretId,
        ...safeParams,
      },
      version: 1,
    });
    return id;
  };

  const generateHDRoot = async (options: GenerateOptions, id: KeyId, ctx?: Ctx): Promise<KeyId> => {
    const seedId = options.params?.parentKeyId as string | undefined;
    await withSeed(options.params, ctx, async (seed) => {
      // The shim derives the 96-byte root and wipes the seed we injected.
      const root = (await subtle.generateKey(
        { name: "BIP32-Ed25519", seed } as unknown as AlgorithmIdentifier,
        false,
        ["sign"],
      )) as CryptoKey;
      // Capture the just-born root once and persist it encrypted at rest.
      await consumeKeyMaterial(root, (m) => putBytes(id, Uint8Array.from(m), ctx));
    });
    await addMetadata({
      id,
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      // `scheme` disambiguates the two kinds of `hd-root-key`: the XHD
      // BIP32-Ed25519 root (this one) vs. the deterministic-P256 PBKDF2 main
      // key. Legacy records predate this flag; an absent `scheme` is treated as
      // `bip32-ed25519`.
      metadata: {
        storage: "bytes",
        scheme: "bip32-ed25519",
        parentKeyId: seedId,
        ...publicParams(options.params),
      },
      version: 1,
    });
    return id;
  };

  /**
   * Generates a deterministic-P256 (passkey) **main key** — the PBKDF2-HMAC-SHA512
   * root of the passkey hierarchy. It shares the `hd-root-key` type with the XHD
   * root but is distinguished by `algorithm: "P256"` + `metadata.scheme:
   * "pbkdf2-p256"`, so no new {@link KeyType} is introduced. Domain passkeys are
   * later derived from it via {@link KeyStoreAPI.deriveDomainKey}.
   */
  const generateDP256Main = async (
    options: GenerateOptions,
    id: KeyId,
    ctx?: Ctx,
  ): Promise<KeyId> => {
    const parentKeyId = options.params?.parentKeyId as string | undefined;
    // Never persist raw secrets into (plaintext) metadata — strip any inline
    // entropy/seed/salt/passphrase the caller passed for generation.
    const safeParams = publicParams(options.params);
    await withSeed(
      options.params,
      ctx,
      async (entropy) => {
        // The shim derives the PBKDF2 main key and wipes the entropy we injected.
        const main = (await subtle.generateKey(
          {
            name: "Deterministic-P256",
            entropy,
            salt: options.params?.salt,
            iterationCount: options.params?.iterationCount,
            keyLengthBytes: options.params?.keyLengthBytes,
          } as unknown as AlgorithmIdentifier,
          false,
          ["sign"],
        )) as CryptoKey;
        // Capture the just-born main key once and persist it encrypted at rest.
        await consumeKeyMaterial(main, (m) => putBytes(id, Uint8Array.from(m), ctx));
        // dp256 PBKDF2s the raw stored bytes itself, so keep the parent's entropy
        // (do not convert a mnemonic seed record's entropy to its derived seed).
      },
      { wantSeed: false },
    );
    await addMetadata({
      id,
      type: "hd-root-key",
      algorithm: "P256",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      metadata: { storage: "bytes", scheme: "pbkdf2-p256", parentKeyId, ...safeParams },
      version: 1,
    });
    return id;
  };

  const generateFalcon = async (options: GenerateOptions, id: KeyId, ctx?: Ctx): Promise<KeyId> => {
    return withSeed(options.params, ctx, async (seed) => {
      const pair = (await subtle.generateKey(
        { name: "Falcon-1024", seed } as unknown as AlgorithmIdentifier,
        options.extractable,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      await consumeKeyMaterial(pair.privateKey, (m) => putBytes(id, Uint8Array.from(m), ctx));
      const publicKey = consumeKeyMaterial(pair.publicKey, (m) => Uint8Array.from(m));
      await addMetadata({
        id,
        type: "falcon-1024",
        algorithm: "Falcon-1024",
        extractable: options.extractable,
        keyUsages: options.keyUsages,
        publicKey,
        metadata: { storage: "bytes", ...publicParams(options.params) },
        version: 1,
      });
      return id;
    });
  };

  const generateEd25519 = async (
    options: GenerateOptions,
    id: KeyId,
    ctx?: Ctx,
  ): Promise<KeyId> => {
    // Generate extractable so we can capture the public bytes, then re-import
    // the private key as NON-extractable for persistence. The extractable copy
    // is discarded; only the non-extractable private key is stored.
    const pair = (await host.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await host.exportKey("raw", pair.publicKey));
    if (native) {
      const pkcs8 = new Uint8Array(await host.exportKey("pkcs8", pair.privateKey));
      const privateKey = await host.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
      pkcs8.fill(0);
      await driver.put(id, { kind: "cryptokey", privateKey, publicKey: pair.publicKey }, ctx);
    } else {
      // Byte-only backend: persist the private key as sealed pkcs8 bytes.
      const pkcs8 = new Uint8Array(await host.exportKey("pkcs8", pair.privateKey));
      await putBytes(id, pkcs8, ctx);
    }
    await addMetadata({
      id,
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: options.keyUsages,
      publicKey,
      format: native ? undefined : "pkcs8",
      metadata: {
        storage: native ? "cryptokey" : "bytes",
        signAlgorithm: { name: "Ed25519" },
        ...publicParams(options.params),
      },
      version: 1,
    });
    return id;
  };

  /**
   * Imports an existing standalone Ed25519 private key (a 32-byte seed) into
   * the keystore, persisting it exactly like {@link generateEd25519} does —
   * the only difference being that the private key material comes from the
   * caller instead of a freshly generated pair.
   *
   * The seed is wrapped into a PKCS#8 document and imported through the host
   * Subtle as a NON-extractable private key for persistence (native or
   * byte-only, mirroring {@link generateEd25519}'s two branches). The actual
   * public key is always re-derived from the seed (via an EXTRACTABLE re-import
   * + JWK export, reading the base64url `x` member) so a caller-supplied
   * `publicKey` can be validated against it rather than blindly trusted.
   */
  const importEd25519 = async (keyData: KeyData, id: KeyId, ctx?: Ctx): Promise<KeyId> => {
    const seed = keyData.privateKey;
    if (!(seed instanceof Uint8Array) || seed.byteLength !== 32) {
      throw new InvalidKeyDataError(
        "ed25519 import requires a 32-byte Uint8Array privateKey (the Ed25519 seed)",
      );
    }
    if (keyData.publicKey !== undefined && keyData.publicKey.byteLength !== 32) {
      throw new InvalidKeyDataError(
        "ed25519 import requires a 32-byte Uint8Array publicKey when supplied",
      );
    }
    const pkcs8 = seedToEd25519Pkcs8(seed);
    // Derive the actual public key from the seed via an EXTRACTABLE re-import +
    // JWK export, so a caller-supplied publicKey can be validated against it.
    const extractable = await host.importKey("pkcs8", bs(pkcs8), { name: "Ed25519" }, true, [
      "sign",
    ]);
    const jwk = (await host.exportKey("jwk", extractable)) as JsonWebKey;
    if (typeof jwk.x !== "string") {
      pkcs8.fill(0);
      throw new InvalidKeyDataError(
        "failed to derive the Ed25519 public key from the supplied privateKey",
      );
    }
    const derivedPublicKey = base64UrlToBytes(jwk.x);
    if (keyData.publicKey && !bytesEqual(keyData.publicKey, derivedPublicKey)) {
      pkcs8.fill(0);
      throw new InvalidKeyDataError("supplied publicKey does not match the Ed25519 privateKey");
    }
    const publicKey = keyData.publicKey ? Uint8Array.from(keyData.publicKey) : derivedPublicKey;

    if (native) {
      const privateKey = await host.importKey("pkcs8", bs(pkcs8), { name: "Ed25519" }, false, [
        "sign",
      ]);
      pkcs8.fill(0);
      const publicCryptoKey = await host.importKey(
        "raw",
        bs(publicKey),
        { name: "Ed25519" },
        true,
        ["verify"],
      );
      await driver.put(id, { kind: "cryptokey", privateKey, publicKey: publicCryptoKey }, ctx);
    } else {
      // Byte-only backend: persist the private key as sealed pkcs8 bytes.
      await putBytes(id, pkcs8, ctx);
    }
    await addMetadata({
      id,
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: keyData.keyUsages ?? ["sign", "verify"],
      publicKey,
      format: native ? undefined : "pkcs8",
      metadata: {
        storage: native ? "cryptokey" : "bytes",
        signAlgorithm: { name: "Ed25519" },
        ...keyData.metadata,
      },
      version: 1,
    });
    return id;
  };

  const generateHostKey = async (
    options: GenerateOptions,
    id: KeyId,
    ctx?: Ctx,
  ): Promise<KeyId> => {
    const algorithm = { name: options.algorithm, ...options.params } as unknown as
      | AlgorithmIdentifier
      | RsaHashedKeyGenParams;
    // The algorithm object handed to `generateKey` may legitimately carry secret
    // inputs; the one RECORDED for later verification must not (see
    // `publicParams`).
    const signAlgorithm = { name: options.algorithm, ...publicParams(options.params) };
    if (native) {
      const result = (await host.generateKey(algorithm, false, options.keyUsages)) as
        | CryptoKey
        | CryptoKeyPair;
      if ("privateKey" in result) {
        await driver.put(
          id,
          { kind: "cryptokey", privateKey: result.privateKey, publicKey: result.publicKey },
          ctx,
        );
      } else {
        await driver.put(id, { kind: "cryptokey", privateKey: result }, ctx);
      }
      await addMetadata({
        id,
        type: options.type,
        algorithm: options.algorithm,
        extractable: false,
        keyUsages: options.keyUsages,
        metadata: { storage: "cryptokey", signAlgorithm, ...publicParams(options.params) },
        version: 1,
      });
      return id;
    }
    // Byte-only backend: generate extractable, serialize and seal the private
    // key (pkcs8 for asymmetric, raw for symmetric), keeping the public bytes.
    const result = (await host.generateKey(algorithm, true, options.keyUsages)) as
      | CryptoKey
      | CryptoKeyPair;
    let publicKey: Uint8Array | undefined;
    let format: KeyFormat;
    if ("privateKey" in result) {
      publicKey = new Uint8Array(await host.exportKey("spki", result.publicKey));
      const pkcs8 = new Uint8Array(await host.exportKey("pkcs8", result.privateKey));
      await putBytes(id, pkcs8, ctx);
      format = "pkcs8";
    } else {
      const raw = new Uint8Array(await host.exportKey("raw", result));
      await putBytes(id, raw, ctx);
      format = "raw";
    }
    await addMetadata({
      id,
      type: options.type,
      algorithm: options.algorithm,
      extractable: false,
      keyUsages: options.keyUsages,
      publicKey,
      format,
      metadata: {
        storage: "bytes",
        signAlgorithm,
        spki: publicKey !== undefined,
        ...publicParams(options.params),
      },
      version: 1,
    });
    return id;
  };

  const api: KeyStore<Ctx> = {
    ready,

    async generate(options: GenerateOptions, ctx?: Ctx): Promise<KeyId> {
      await ready;
      const id = (options.params?.id as string | undefined) ?? crypto.randomUUID();
      setStatus("generating");
      try {
        if (options.algorithm === "Falcon-1024") return await generateFalcon(options, id, ctx);
        // Fresh mnemonic seeds (BIP39 / Algo25) mint recoverable entropy via the
        // seed shims. Importing an existing seed goes through `importSeed`.
        if (options.type === "seed" || options.type === "hd-seed") {
          return await generateSeed(options, id, ctx);
        }
        if (options.type === "hd-root-key") {
          // A `pbkdf2-p256` main key shares the `hd-root-key` type with the XHD
          // root; `algorithm: "P256"` (or an explicit scheme) selects it.
          if (options.algorithm === "P256" || options.params?.scheme === "pbkdf2-p256") {
            return await generateDP256Main(options, id, ctx);
          }
          return await generateHDRoot(options, id, ctx);
        }
        if (options.type === "ed25519") return await generateEd25519(options, id, ctx);
        return await generateHostKey(options, id, ctx);
      } finally {
        setStatus("idle");
      }
    },

    async importSeed(seed: Uint8Array, opts?: KeyOptions, ctx?: Ctx): Promise<KeyId> {
      await ready;
      const id = opts?.id ?? crypto.randomUUID();
      setStatus("importing");
      try {
        await putBytes(id, Uint8Array.from(seed), ctx);
        await addMetadata({
          id,
          type: "seed",
          algorithm: "raw",
          extractable: false,
          keyUsages: ["deriveBits", "deriveKey"],
          metadata: { storage: "bytes", name: opts?.name ?? "Imported Seed", ...opts?.metadata },
          version: 1,
        });
        return id;
      } finally {
        setStatus("idle");
      }
    },

    async deriveFromSeed(
      seedId: KeyId,
      path: string,
      opts?: DeriveOptions,
      ctx?: Ctx,
    ): Promise<KeyId> {
      await ready;
      setStatus("deriving");
      try {
        const parent = await loadMetadata(seedId);
        if (parent.type !== "hd-root-key") {
          throw new InvalidKeyDataError("deriveFromSeed expects an hd-root-key parent");
        }
        const bip44Path = parsePath(path);
        const derivationType =
          opts?.mode === "standard"
            ? BIP32DerivationType.Khovratovich
            : BIP32DerivationType.Peikert;

        // Re-derive the child PUBLIC key by injecting the decrypted root; the
        // shim wipes the injected root once derivation completes.
        const derived = await driver.use(seedId, ctx, async (m) => {
          if (m.kind !== "bytes") {
            throw new InvalidKeyDataError(`root ${seedId} does not hold key bytes`);
          }
          const handle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
          return new Uint8Array(
            (await subtle.deriveBits(
              {
                name: "BIP32-Ed25519",
                bip44Path,
                derivationType,
                rootKey: m.bytes,
              } as unknown as AlgorithmIdentifier,
              handle,
            )) as ArrayBuffer,
          );
        });
        const publicKey = derived.subarray(0, 32);

        const id = opts?.id ?? crypto.randomUUID();
        await addMetadata({
          id,
          type: "hd-derived-ed25519",
          algorithm: "EdDSA",
          extractable: false,
          keyUsages: ["sign", "verify"],
          publicKey,
          metadata: {
            storage: "none",
            parentKeyId: seedId,
            path,
            bip44Path,
            derivationType,
            ...opts?.metadata,
          },
          version: 1,
        });
        return id;
      } finally {
        setStatus("idle");
      }
    },

    async deriveDomainKey(mainKeyId: KeyId, opts: DeriveOptions, ctx?: Ctx): Promise<KeyId> {
      await ready;
      setStatus("deriving");
      try {
        const parent = await loadMetadata(mainKeyId);
        if (parent.type !== "hd-root-key" || parent.metadata?.scheme !== "pbkdf2-p256") {
          throw new InvalidKeyDataError("deriveDomainKey expects a pbkdf2-p256 hd-root-key parent");
        }
        if (typeof opts.origin !== "string" || typeof opts.userHandle !== "string") {
          throw new InvalidKeyDataError("deriveDomainKey requires an origin and userHandle");
        }
        const origin = opts.origin;
        const userHandle = opts.userHandle;
        const counter = opts.counter ?? 0;

        // Re-derive the child PUBLIC key by injecting the decrypted main key; the
        // shim wipes the injected main key once derivation completes.
        const publicKey = await driver.use(mainKeyId, ctx, async (m) => {
          if (m.kind !== "bytes") {
            throw new InvalidKeyDataError(`main key ${mainKeyId} does not hold key bytes`);
          }
          const handle = createKeyHandle("private", { name: "Deterministic-P256" }, false, [
            "sign",
          ]);
          return new Uint8Array(
            (await subtle.deriveBits(
              {
                name: "Deterministic-P256",
                origin,
                userHandle,
                counter,
                mainKey: m.bytes,
              } as unknown as AlgorithmIdentifier,
              handle,
            )) as ArrayBuffer,
          );
        });

        const id = opts.id ?? crypto.randomUUID();
        await addMetadata({
          id,
          type: "hd-derived-p256",
          algorithm: "P256",
          extractable: false,
          keyUsages: ["sign", "verify"],
          publicKey,
          metadata: {
            storage: "none",
            scheme: "pbkdf2-p256",
            parentKeyId: mainKeyId,
            origin,
            userHandle,
            counter,
            ...opts.metadata,
          },
          version: 1,
        });
        return id;
      } finally {
        setStatus("idle");
      }
    },

    async sign(id: KeyId, data: Uint8Array, _algorithm?: string, ctx?: Ctx): Promise<Uint8Array> {
      await ready;
      const key = await loadMetadata(id);
      setStatus("signing");
      try {
        switch (key.type) {
          case "hd-derived-ed25519": {
            const parentKeyId = key.metadata?.parentKeyId as string;
            return await driver.use(parentKeyId, ctx, async (m) => {
              if (m.kind !== "bytes") {
                throw new InvalidKeyDataError(`root ${parentKeyId} does not hold key bytes`);
              }
              const handle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
              const signature = await subtle.sign(
                {
                  name: "BIP32-Ed25519",
                  bip44Path: key.metadata?.bip44Path,
                  derivationType: key.metadata?.derivationType,
                  rootKey: m.bytes,
                } as unknown as AlgorithmIdentifier,
                handle,
                bs(data),
              );
              return new Uint8Array(signature);
            });
          }
          case "falcon-1024": {
            return await driver.use(id, ctx, async (m) => {
              if (m.kind !== "bytes") {
                throw new InvalidKeyDataError(`key ${id} does not hold Falcon bytes`);
              }
              const handle = createKeyHandle("private", { name: "Falcon-1024" }, false, ["sign"]);
              const signature = await subtle.sign(
                { name: "Falcon-1024", privateKey: m.bytes } as unknown as AlgorithmIdentifier,
                handle,
                bs(data),
              );
              return new Uint8Array(signature);
            });
          }
          case "hd-derived-p256": {
            const parentKeyId = key.metadata?.parentKeyId as string;
            return await driver.use(parentKeyId, ctx, async (m) => {
              if (m.kind !== "bytes") {
                throw new InvalidKeyDataError(`main key ${parentKeyId} does not hold key bytes`);
              }
              const handle = createKeyHandle("private", { name: "Deterministic-P256" }, false, [
                "sign",
              ]);
              const signature = await subtle.sign(
                {
                  name: "Deterministic-P256",
                  origin: key.metadata?.origin,
                  userHandle: key.metadata?.userHandle,
                  counter: key.metadata?.counter,
                  mainKey: m.bytes,
                } as unknown as AlgorithmIdentifier,
                handle,
                bs(data),
              );
              return new Uint8Array(signature);
            });
          }
          case "hd-root-key":
          case "seed":
            throw new InvalidKeyDataError(`${key.type} keys cannot sign; derive a child key first`);
          default: {
            const signAlgorithm =
              (key.metadata?.signAlgorithm as AlgorithmIdentifier | undefined) ??
              ({ name: key.algorithm } as AlgorithmIdentifier);
            return await driver.use(id, ctx, async (m) => {
              let privateKey: CryptoKey;
              if (m.kind === "cryptokey") {
                privateKey = m.privateKey;
              } else {
                // Byte-only backend: re-import the serialized private key.
                const format = (key.format as "pkcs8" | "raw") ?? "pkcs8";
                privateKey = await host.importKey(format, bs(m.bytes), signAlgorithm, false, [
                  "sign",
                ]);
              }
              const signature = await subtle.sign(signAlgorithm, privateKey, bs(data));
              return new Uint8Array(signature);
            });
          }
        }
      } finally {
        setStatus("idle");
      }
    },

    async verify(
      id: KeyId,
      data: Uint8Array,
      signature: Uint8Array,
      _algorithm?: string,
    ): Promise<boolean> {
      await ready;
      const key = await loadMetadata(id);
      setStatus("verifying");
      try {
        switch (key.type) {
          case "hd-derived-ed25519": {
            if (!key.publicKey) throw new InvalidKeyDataError("missing public key for verify");
            const handle = createKeyHandle("public", { name: "BIP32-Ed25519" }, true, ["verify"]);
            return await subtle.verify(
              {
                name: "BIP32-Ed25519",
                bip44Path: key.metadata?.bip44Path,
                publicKey: key.publicKey,
              } as unknown as AlgorithmIdentifier,
              handle,
              bs(signature),
              bs(data),
            );
          }
          case "falcon-1024": {
            if (!key.publicKey) throw new InvalidKeyDataError("missing public key for verify");
            const handle = createKeyHandle("public", { name: "Falcon-1024" }, true, ["verify"]);
            return await subtle.verify(
              { name: "Falcon-1024", publicKey: key.publicKey } as unknown as AlgorithmIdentifier,
              handle,
              bs(signature),
              bs(data),
            );
          }
          case "hd-derived-p256": {
            if (!key.publicKey) throw new InvalidKeyDataError("missing public key for verify");
            // The derived passkey is an ordinary P-256 key; the shim verifies it
            // via the host's native ECDSA and needs only the (non-secret) public
            // key, so no main-key unlock is required.
            const handle = createKeyHandle("public", { name: "Deterministic-P256" }, true, [
              "verify",
            ]);
            return await subtle.verify(
              {
                name: "Deterministic-P256",
                publicKey: key.publicKey,
              } as unknown as AlgorithmIdentifier,
              handle,
              bs(signature),
              bs(data),
            );
          }
          case "ed25519": {
            if (!key.publicKey) throw new InvalidKeyDataError("missing public key for verify");
            const publicKey = await host.importKey(
              "raw",
              bs(key.publicKey),
              { name: "Ed25519" },
              true,
              ["verify"],
            );
            return await host.verify({ name: "Ed25519" }, publicKey, bs(signature), bs(data));
          }
          default: {
            const verifyAlgorithm =
              (key.metadata?.signAlgorithm as AlgorithmIdentifier | undefined) ??
              ({ name: key.algorithm } as AlgorithmIdentifier);
            // A public SPKI is recorded in metadata on byte-only backends.
            if (key.publicKey && key.metadata?.spki) {
              const publicKey = await host.importKey(
                "spki",
                bs(key.publicKey),
                verifyAlgorithm,
                true,
                ["verify"],
              );
              return await host.verify(verifyAlgorithm, publicKey, bs(signature), bs(data));
            }
            // Otherwise the public key rides on the persisted CryptoKey material.
            return await driver.use(id, undefined, async (m) => {
              if (m.kind !== "cryptokey" || !m.publicKey) {
                throw new InvalidKeyDataError("missing public key for verify");
              }
              return subtle.verify(verifyAlgorithm, m.publicKey, bs(signature), bs(data));
            });
          }
        }
      } finally {
        setStatus("idle");
      }
    },

    async export(id: KeyId, _options?: ExportOptions, _ctx?: Ctx): Promise<KeyData> {
      await ready;
      const key = await loadMetadata(id);
      // Only public metadata ever leaves the engine; private material is owned
      // by the storage layer and never crosses the public surface.
      return { ...key } as KeyData;
    },

    async remove(id: KeyId, ctx?: Ctx): Promise<void> {
      await ready;
      // A seed's sealed passphrase is worthless without the seed, so it goes
      // with it rather than lingering as an orphaned secret.
      const passphraseSecretId = store.state.keys.find((k) => k.id === id)?.metadata
        ?.passphraseSecretId;
      await driver.remove(id, ctx);
      if (typeof passphraseSecretId === "string") {
        try {
          await driver.remove(passphraseSecretId, ctx);
        } catch {
          // Already gone; the metadata below is dropped either way.
        }
      }
      store.setState((s) => ({
        ...s,
        keys: s.keys.filter((k) => k.id !== id && k.id !== passphraseSecretId),
      }));
    },

    ...(driver.clear
      ? {
          async clear(ctx?: Ctx): Promise<void> {
            await ready;
            // driver.clear is guaranteed defined in this branch.
            await driver.clear?.(ctx);
            store.setState((s) => ({ ...s, keys: [] }));
          },
        }
      : {}),

    async encryptWithKey(
      id: KeyId,
      data: Uint8Array,
      _algorithm?: string,
      _ctx?: Ctx,
    ): Promise<Uint8Array> {
      await ready;
      const key = await loadMetadata(id);
      if (!key.publicKey) {
        throw new InvalidKeyDataError(`key ${id} has no public key to encrypt with`);
      }
      setStatus("encrypting");
      try {
        const aes = await deriveAesKeyFromPublic(host, key.publicKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = new Uint8Array(
          await host.encrypt({ name: "AES-GCM", iv: bs(iv) }, aes, bs(data)),
        );
        // Layout: [version(1) | iv(12) | ciphertext].
        const out = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength);
        out[0] = ENCRYPT_VERSION;
        out.set(iv, 1);
        out.set(ciphertext, 1 + iv.byteLength);
        return out;
      } finally {
        setStatus("idle");
      }
    },

    async decryptWithKey(
      id: KeyId,
      data: Uint8Array,
      _algorithm?: string,
      _ctx?: Ctx,
    ): Promise<Uint8Array> {
      await ready;
      const key = await loadMetadata(id);
      if (!key.publicKey) {
        throw new InvalidKeyDataError(`key ${id} has no public key to decrypt with`);
      }
      setStatus("decrypting");
      try {
        const version = data[0];
        if (version !== ENCRYPT_VERSION) {
          throw new InvalidKeyFormatError(`unsupported ciphertext version: ${String(version)}`);
        }
        const iv = data.subarray(1, 13);
        const ciphertext = data.subarray(13);
        const aes = await deriveAesKeyFromPublic(host, key.publicKey as Uint8Array);
        return new Uint8Array(
          await host.decrypt({ name: "AES-GCM", iv: bs(iv) }, aes, bs(ciphertext)),
        );
      } finally {
        setStatus("idle");
      }
    },

    async deriveSharedSecret(
      id: KeyId,
      publicKey: Uint8Array,
      meFirst: boolean,
      _algorithm?: string,
      ctx?: Ctx,
    ): Promise<Uint8Array> {
      await ready;
      const key = await loadMetadata(id);
      setStatus("deriving");
      try {
        if (key.type === "hd-derived-ed25519") {
          // XHD Diffie-Hellman: unlock the root just-in-time and let the shim
          // run ECDH along the recorded path against the remote public key.
          const parentKeyId = key.metadata?.parentKeyId as string;
          return await driver.use(parentKeyId, ctx, async (m) => {
            if (m.kind !== "bytes") {
              throw new InvalidKeyDataError(`root ${parentKeyId} does not hold key bytes`);
            }
            const handle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, [
              "deriveBits",
            ]);
            const secret = await subtle.deriveBits(
              {
                name: "BIP32-Ed25519",
                bip44Path: key.metadata?.bip44Path,
                derivationType: key.metadata?.derivationType,
                rootKey: m.bytes,
                otherPartyPub: publicKey,
                meFirst,
              } as unknown as AlgorithmIdentifier,
              handle,
            );
            return new Uint8Array(secret as ArrayBuffer);
          });
        }
        // Standard EC key: perform host-native ECDH. The stored private key is
        // re-imported for ECDH usage just-in-time.
        const namedCurve = (key.metadata?.namedCurve as string | undefined) ?? "P-256";
        const remote = await host.importKey(
          "raw",
          bs(publicKey),
          { name: "ECDH", namedCurve },
          false,
          [],
        );
        return await driver.use(id, ctx, async (m) => {
          let privateKey: CryptoKey;
          if (m.kind === "cryptokey") {
            privateKey = m.privateKey;
          } else {
            const format = (key.format as "pkcs8" | "raw") ?? "pkcs8";
            privateKey = await host.importKey(
              format,
              bs(m.bytes),
              { name: "ECDH", namedCurve },
              false,
              ["deriveBits"],
            );
          }
          const secret = await host.deriveBits({ name: "ECDH", public: remote }, privateKey, 256);
          return new Uint8Array(secret);
        });
      } finally {
        setStatus("idle");
      }
    },

    async import(
      data: (Omit<KeyData, "id"> & { id?: KeyId }) | Uint8Array | string,
      _format?: KeyFormat,
      ctx?: Ctx,
    ): Promise<KeyId> {
      await ready;
      if (data instanceof Uint8Array || typeof data === "string") {
        throw new InvalidKeyFormatError(
          "importing raw/encoded bytes is not supported; use KeyData",
        );
      }
      const keyData = data as KeyData & { id?: KeyId };
      const id = keyData.id ?? crypto.randomUUID();
      setStatus("importing");
      try {
        if (keyData.type === "seed" || keyData.type === "hd-root-key") {
          if (!(keyData.privateKey instanceof Uint8Array)) {
            throw new InvalidKeyDataError(`${keyData.type} import requires Uint8Array privateKey`);
          }
          await putBytes(id, Uint8Array.from(keyData.privateKey), ctx);
          await addMetadata({
            id,
            type: keyData.type,
            algorithm: "raw",
            extractable: false,
            keyUsages: keyData.keyUsages ?? ["deriveBits", "deriveKey"],
            metadata: { storage: "bytes", ...keyData.metadata },
            version: 1,
          });
          return id;
        }
        if (keyData.type === "ed25519") return await importEd25519(keyData, id, ctx);
        throw new InvalidKeyDataError(`import of type ${keyData.type} is not supported`);
      } finally {
        setStatus("idle");
      }
    },

    async batchSign(ids: KeyId[], data: Uint8Array[], ctx?: Ctx): Promise<Uint8Array[]> {
      const signatures: Uint8Array[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        signatures.push(await this.sign(ids[i] as KeyId, data[i] as Uint8Array, undefined, ctx));
      }
      return signatures;
    },

    // A general-purpose store for arbitrary secrets (no crypto role). Unlike key
    // material, a secret's value is readable back in plaintext via `get`; only
    // its non-secret metadata is mirrored into the reactive store.
    secrets: {
      async put(
        value: Uint8Array | string,
        opts?: { id?: KeyId; name?: string; metadata?: Record<string, unknown> },
        ctx?: Ctx,
      ): Promise<KeyId> {
        await ready;
        const id = opts?.id ?? crypto.randomUUID();
        const bytes =
          typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
        setStatus("storing");
        try {
          await putBytes(id, bytes, ctx);
          await addMetadata({
            id,
            type: "secret-key",
            algorithm: "raw",
            extractable: false,
            keyUsages: [],
            metadata: { storage: "bytes", name: opts?.name ?? "Secret", ...opts?.metadata },
            version: 1,
          });
          return id;
        } finally {
          setStatus("idle");
        }
      },

      async get(id: KeyId, ctx?: Ctx): Promise<Uint8Array> {
        await ready;
        const key = await loadMetadata(id);
        if (key.type !== "secret-key") {
          throw new InvalidKeyDataError(`key ${id} is not a secret`);
        }
        return driver.use(id, ctx, (m) => {
          if (m.kind !== "bytes") {
            throw new InvalidKeyDataError(`secret ${id} does not hold bytes`);
          }
          return Uint8Array.from(m.bytes);
        });
      },

      async list(): Promise<Key[]> {
        await ready;
        return store.state.keys.filter((k) => k.type === "secret-key");
      },

      async remove(id: KeyId, ctx?: Ctx): Promise<void> {
        await ready;
        await driver.remove(id, ctx);
        store.setState((s) => ({ ...s, keys: s.keys.filter((k) => k.id !== id) }));
      },
    },
  };

  // No hooks requested: return the bare orchestrator.
  if (!options.hooks) return api;

  // Hooks were bound at creation. Wrap each material-touching method so
  // `before`/`after`/`error` hooks can intercept it, and expose the collection
  // as `keystore.hooks`. Inner calls (e.g. `batchSign` → `sign`) run against the
  // unwrapped `api`, so a batch fires only the `batchSign` hook, not one `sign`
  // hook per item.
  const hooks = options.hooks;
  const run = hooks as unknown as (
    name: string,
    method: () => Promise<unknown>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;

  const intercept = <A extends unknown[], R>(
    name: string,
    method: ((...args: A) => Promise<R>) | undefined,
  ): ((...args: A) => Promise<R>) | undefined =>
    method === undefined
      ? undefined
      : (...args: A): Promise<R> =>
          run(name, () => method.apply(api, args), { args }) as Promise<R>;

  const wrapped = { ...api, hooks } as KeyStore<Ctx>;
  wrapped.generate = intercept("generate", api.generate.bind(api)) as KeyStore<Ctx>["generate"];
  wrapped.import = intercept("import", api.import.bind(api)) as KeyStore<Ctx>["import"];
  wrapped.export = intercept("export", api.export.bind(api)) as KeyStore<Ctx>["export"];
  wrapped.remove = intercept("remove", api.remove.bind(api)) as KeyStore<Ctx>["remove"];
  wrapped.sign = intercept("sign", api.sign.bind(api)) as KeyStore<Ctx>["sign"];
  wrapped.verify = intercept("verify", api.verify.bind(api)) as KeyStore<Ctx>["verify"];
  wrapped.encryptWithKey = intercept("encryptWithKey", api.encryptWithKey?.bind(api));
  wrapped.decryptWithKey = intercept("decryptWithKey", api.decryptWithKey?.bind(api));
  wrapped.deriveSharedSecret = intercept("deriveSharedSecret", api.deriveSharedSecret?.bind(api));
  wrapped.importSeed = intercept("importSeed", api.importSeed?.bind(api));
  wrapped.deriveFromSeed = intercept("deriveFromSeed", api.deriveFromSeed?.bind(api));
  wrapped.deriveDomainKey = intercept("deriveDomainKey", api.deriveDomainKey?.bind(api));
  wrapped.batchSign = intercept("batchSign", api.batchSign?.bind(api));
  if (api.clear) wrapped.clear = intercept("clear", api.clear.bind(api));

  return wrapped;
}
