/**
 * The React Native Keychain/MMKV {@link KeyStoreDriver}: the mobile "material
 * custodian" for the shared {@link createKeyStore} orchestrator.
 *
 * Unlike IndexedDB, MMKV is a string/number/bytes key-value store — it cannot
 * hold a live {@link CryptoKey}, so this driver's
 * {@link DriverCapabilities.nativeCryptoKey} is `false` and every secret is
 * serialized to bytes, sealed with a Keychain-backed AES-256-GCM master key and
 * persisted encrypted at rest. Because unlocking the master key can require an
 * interactive biometric/passcode prompt, {@link DriverCapabilities.interactiveUnlock}
 * is `true` and the per-operation context is {@link AuthenticationOptions}, which
 * is threaded straight into the master-key read.
 *
 * The driver is intentionally free of any hard dependency on the native
 * libraries: the MMKV-style store and the encrypt-at-rest primitives are
 * injected as {@link KeychainDriverDeps}. `createReactNativeKeyStore` supplies
 * the concrete `react-native-mmkv` / `react-native-keychain` /
 * `react-native-quick-crypto` bindings; tests can inject in-memory fakes.
 */

import type {
  DriverCapabilities,
  DriverMaterial,
  Key,
  KeyId,
  KeyStoreDriver,
} from "@algorandfoundation/keystore-core";
import { KeyNotFoundError } from "@algorandfoundation/keystore-core";
import { base64 } from "@scure/base";

import type { AuthenticationOptions } from "../types.ts";

/** Storage-key prefixes so material and metadata share one MMKV instance. */
const MATERIAL_PREFIX = "m/";
const METADATA_PREFIX = "k/";

/**
 * The minimal MMKV-style synchronous key/value surface the driver relies on.
 * Mirrors `react-native-mmkv`'s `MMKV` so the real instance satisfies it
 * directly, while tests can supply a `Map`-backed fake.
 */
export interface KeychainStorage {
  /** Reads a stored string, or `undefined` when absent. */
  getString(key: string): string | undefined;
  /** Writes a string value. */
  set(key: string, value: string): void;
  /** Removes a value. */
  remove(key: string): void;
  /** Lists every stored key (used to enumerate metadata). */
  getAllKeys(): string[];
}

/**
 * The encrypt-at-rest primitives the driver needs, decoupled from the native
 * libraries. `createReactNativeKeyStore` wires these to the Keychain-backed
 * master key + `react-native-quick-crypto` AES-256-GCM helpers.
 */
export interface KeychainCrypto {
  /**
   * Resolves the master key for a **write**, creating one on first use when the
   * store is still empty. May prompt when biometrics are requested.
   */
  masterKeyForWrite(options?: AuthenticationOptions): Promise<Uint8Array>;
  /**
   * Resolves the existing master key for a **read**. May trigger an interactive
   * unlock; throws if the key is missing or unlock fails/cancels.
   */
  masterKeyForRead(options?: AuthenticationOptions): Promise<Uint8Array>;
  /** Seals `data` with `key`, returning an opaque string payload. */
  seal(key: Uint8Array, data: string): Promise<string>;
  /** Opens a payload produced by {@link KeychainCrypto.seal}. */
  open(key: Uint8Array, payload: string): Promise<string>;
  /** Best-effort zeroing of a key buffer once an operation completes. */
  wipe(key: Uint8Array): void;
}

/** Dependencies for {@link createKeychainDriver}. */
export interface KeychainDriverDeps {
  /** The MMKV-style store holding sealed material + serialized metadata. */
  storage: KeychainStorage;
  /** The Keychain-backed encrypt-at-rest primitives. */
  crypto: KeychainCrypto;
}

const CAPABILITIES: DriverCapabilities = {
  nativeCryptoKey: false,
  interactiveUnlock: true,
  authFactors: ["biometrics", "passcode-fallback"],
};

/** Serializes {@link Key} metadata to a string, base64-encoding any bytes. */
function serializeKey(key: Key): string {
  return JSON.stringify(key, (_k, value) => {
    if (value instanceof Uint8Array) return { $u8: base64.encode(value) };
    return value;
  });
}

/** Reverses {@link serializeKey}, restoring `Uint8Array` fields. */
function deserializeKey(data: string): Key {
  return JSON.parse(data, (_k, value) => {
    if (value && typeof value === "object" && typeof value.$u8 === "string") {
      return base64.decode(value.$u8);
    }
    return value;
  }) as Key;
}

/**
 * Creates a byte-only {@link KeyStoreDriver} backed by an injected MMKV-style
 * store and Keychain-backed AES-256-GCM sealing.
 *
 * Every secret is serialized, sealed with the master key and stored encrypted
 * at rest; decrypted bytes live only inside the {@link KeyStoreDriver.use}
 * callback and are wiped once it settles. The per-operation
 * {@link AuthenticationOptions} context is forwarded to the master-key read so a
 * biometric prompt is raised exactly when a secret is actually needed.
 *
 * @param deps - {@link KeychainDriverDeps}.
 * @returns A {@link KeyStoreDriver} to hand to {@link createKeyStore}.
 */
export function createKeychainDriver(
  deps: KeychainDriverDeps,
): KeyStoreDriver<AuthenticationOptions> {
  const { storage, crypto } = deps;

  return {
    capabilities: CAPABILITIES,

    async put(id: KeyId, material: DriverMaterial, ctx?: AuthenticationOptions): Promise<void> {
      if (material.kind !== "bytes") {
        throw new Error("the Keychain/MMKV driver cannot persist a CryptoKey; expected bytes");
      }
      const master = await crypto.masterKeyForWrite(ctx);
      try {
        const payload = base64.encode(material.bytes);
        storage.set(MATERIAL_PREFIX + id, await crypto.seal(master, payload));
      } finally {
        crypto.wipe(master);
        material.bytes.fill(0);
      }
    },

    async use<T>(
      id: KeyId,
      ctx: AuthenticationOptions | undefined,
      fn: (material: DriverMaterial) => T | Promise<T>,
    ): Promise<T> {
      const sealed = storage.getString(MATERIAL_PREFIX + id);
      if (sealed === undefined) throw new KeyNotFoundError(id);
      const master = await crypto.masterKeyForRead(ctx);
      let bytes: Uint8Array;
      try {
        bytes = base64.decode(await crypto.open(master, sealed));
      } finally {
        crypto.wipe(master);
      }
      try {
        return await fn({ kind: "bytes", bytes });
      } finally {
        // Defence-in-depth: the shims wipe injected material, but a decrypted
        // buffer must never outlive the operation regardless of the consumer.
        bytes.fill(0);
      }
    },

    async remove(id: KeyId): Promise<void> {
      storage.remove(MATERIAL_PREFIX + id);
      storage.remove(METADATA_PREFIX + id);
    },

    async clear(): Promise<void> {
      // Only remove this keystore's own records; leave any unrelated MMKV keys
      // (and the Keychain-held master key) untouched.
      for (const key of storage.getAllKeys()) {
        if (key.startsWith(MATERIAL_PREFIX) || key.startsWith(METADATA_PREFIX)) {
          storage.remove(key);
        }
      }
    },

    async putMeta(key: Key): Promise<void> {
      storage.set(METADATA_PREFIX + key.id, serializeKey(key));
    },

    async getMeta(id: KeyId): Promise<Key | undefined> {
      const raw = storage.getString(METADATA_PREFIX + id);
      return raw === undefined ? undefined : deserializeKey(raw);
    },

    async listMeta(): Promise<Key[]> {
      return storage
        .getAllKeys()
        .filter((k) => k.startsWith(METADATA_PREFIX))
        .map((k) => deserializeKey(storage.getString(k) as string));
    },
  } satisfies KeyStoreDriver<AuthenticationOptions>;
}

/**
 * Marker written to a migrated record's `metadata.migration` field. A UI can
 * surface these so the user can delete the stale passkey and recreate it under
 * the new deterministic-P256 (PBKDF2 main key) scheme.
 */
export const PASSKEY_MIGRATION_NEEDED = "needs-migration";

/**
 * Flags **legacy passkeys** in place, non-destructively, on startup.
 *
 * Passkeys created before the deterministic-P256 split were derived directly
 * from the XHD BIP32-Ed25519 root; they carry `type: "hd-derived-p256"` but
 * **not** `metadata.scheme === "pbkdf2-p256"`. Those keys are not reproducible
 * under the new scheme (whose passkeys derive from a separate PBKDF2 *main
 * key*), so rather than silently breaking them this marks each affected record
 * **in place** with `metadata.migration = "needs-migration"`, preserving its id
 * and the domain descriptor (`origin`/`userHandle`/`counter`) so the app can
 * prompt the user to delete the stale passkey and recreate it under the new
 * scheme.
 *
 * The record is updated in place (no copy is created), so the user acts on the
 * very same passkey instance. The scan is metadata-only (`k/` bucket) — no
 * material is decrypted and no biometric prompt is raised — and it is
 * idempotent: a record already flagged `needs-migration` is skipped.
 *
 * @param storage - The MMKV-style store holding this keystore's metadata.
 * @returns The records that were flagged (may be empty).
 */
export function migrateLegacyPasskeys(storage: KeychainStorage): Key[] {
  const records = storage
    .getAllKeys()
    .filter((k) => k.startsWith(METADATA_PREFIX))
    .map((k) => deserializeKey(storage.getString(k) as string));

  const flagged: Key[] = [];
  for (const record of records) {
    if (record.type !== "hd-derived-p256") continue;
    // New-scheme passkeys are fine and already-flagged records are skipped so
    // the pass stays idempotent.
    if (record.metadata?.scheme === "pbkdf2-p256") continue;
    if (record.metadata?.migration === PASSKEY_MIGRATION_NEEDED) continue;

    const updated: Key = {
      ...record,
      metadata: {
        ...record.metadata,
        migration: PASSKEY_MIGRATION_NEEDED,
      },
    };
    storage.set(METADATA_PREFIX + record.id, serializeKey(updated));
    flagged.push(updated);
  }
  return flagged;
}
