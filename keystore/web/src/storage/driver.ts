/**
 * The IndexedDB {@link KeyStoreDriver}: the browser's "material custodian" for
 * the shared {@link createKeyStore} orchestrator.
 *
 * IndexedDB's defining capability is that it can structured-clone a
 * **non-extractable {@link CryptoKey}**, so standard-algorithm keys are
 * persisted as real keys that never become raw bytes in JS
 * ({@link DriverCapabilities.nativeCryptoKey} is `true`, unless a `masterKey`
 * provider is supplied — see {@link IndexedDBDriverOptions.masterKey}). Shim key material
 * (BIP32-Ed25519 roots, Falcon private keys) and raw seeds cannot be
 * structured-cloned, so those are sealed with the vault master key and stored
 * as bytes encrypted at rest.
 *
 * The driver is non-interactive: it never prompts, so its per-operation context
 * is ignored.
 */

import type {
  DriverCapabilities,
  DriverMaterial,
  Key,
  KeyId,
  KeyStoreDriver,
} from "@algorandfoundation/keystore-core";
import { InvalidKeyDataError, KeyNotFoundError } from "@algorandfoundation/keystore-core";

import {
  type KeyStoreDatabase,
  MATERIAL_STORE,
  type MaterialRecord,
  METADATA_STORE,
  openDatabase,
} from "./db.ts";
import { getMasterKey, MASTER_KEY_ID, open, seal, type SealedBytes } from "./vault.ts";

/** Options for {@link createIndexedDBDriver}. */
export interface IndexedDBDriverOptions {
  /** Host Subtle used for the AES-GCM vault master key (never a shim decorator). */
  host: SubtleCrypto;
  /** IndexedDB factory; defaults to `globalThis.indexedDB`. Injectable for tests. */
  indexedDB?: IDBFactory;
  /** Database name; defaults to `"keystore"`. */
  databaseName?: string;
  /**
   * Supplies the AES-GCM key that seals byte material, in place of the one the
   * vault mints and persists itself.
   *
   * Hand this in to bind material to a secret the browser cannot produce on
   * its own — one derived from a user password, or held by another context —
   * so that a copy of the profile directory is not enough to open material
   * written from here on. `ready` then only opens the database, the reserved
   * {@link MASTER_KEY_ID} record is never minted, and the driver reports
   * `nativeCryptoKey: false` so that keys which would otherwise persist as
   * non-extractable `CryptoKey`s are sealed with this key as well. That trade
   * is deliberate but real: sealed keys are decrypted into JS memory for each
   * use, where a native `CryptoKey` never is.
   *
   * It is not a migration, and switching it on over a database the default
   * vault wrote splits that database in two. Byte material the vault already
   * sealed — seeds, HD roots, Falcon keys — stops opening, because `use()`
   * asks the provider for a key that did not seal it and AES-GCM rejects; it
   * cannot be re-imported either, since it can no longer be read. Migrate by
   * reading such material out under the default driver and re-writing it
   * under the provider before switching, or the user re-imports from their
   * recovery phrase. Records persisted natively as `CryptoKey`s keep working,
   * which is its own caveat: they were never sealed, so they stay openable
   * from a copy of the profile.
   *
   * It is called afresh for every operation that seals or opens byte material,
   * never captured: a provider is free to reject while the key is unavailable
   * (a locked vault) and to resolve again once it is not.
   */
  masterKey?: () => Promise<CryptoKey>;
}

const CAPABILITIES: DriverCapabilities = {
  nativeCryptoKey: true,
  interactiveUnlock: false,
  authFactors: [],
};

/**
 * Rejects any operation addressing {@link MASTER_KEY_ID}.
 *
 * The vault master key lives in the same object store as user material, so an
 * id collision is not merely a naming clash: writing over it would orphan every
 * sealed record in the database, and deleting it would do the same on the next
 * reload. The id is reserved — it is never listed, never removed and never
 * overwritten — so a caller that picks it gets a loud error instead of a
 * silently broken vault.
 */
function assertNotReserved(id: KeyId): void {
  if (id === MASTER_KEY_ID) {
    throw new InvalidKeyDataError(`${MASTER_KEY_ID} is reserved for the vault master key`);
  }
}

/**
 * Creates a {@link KeyStoreDriver} backed by IndexedDB.
 *
 * Standard keys persist as non-extractable {@link CryptoKey}s; byte material is
 * encrypted at rest with a non-extractable AES-GCM master key held in the same
 * database. Intended to be handed to {@link createKeyStore}.
 *
 * @param options - {@link IndexedDBDriverOptions}.
 * @returns A ready-to-use {@link KeyStoreDriver}. Its `ready` promise resolves
 *   once the database is open and, unless a `masterKey` provider supplies one,
 *   the vault master key is available.
 */
export function createIndexedDBDriver(options: IndexedDBDriverOptions): KeyStoreDriver {
  const host = options.host;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? "keystore";

  const provided = options.masterKey;

  let db!: KeyStoreDatabase;
  let master!: CryptoKey;

  const ready = (async (): Promise<void> => {
    db = await openDatabase(databaseName, factory);
    if (!provided) master = await getMasterKey(db, host);
  })();

  // Resolved per operation rather than once in `ready`. A provider may be
  // unable to answer yet — a vault the user has not unlocked — and a key
  // captured at startup would outlive the next lock; awaiting it in `ready`
  // would instead reject the driver for good in a context that boots locked.
  const resolveMaster = (): Promise<CryptoKey> => (provided ? provided() : Promise.resolve(master));

  // An externally supplied key is only worth supplying if everything is bound
  // to it: left on, the native path would persist private keys as
  // non-extractable `CryptoKey`s the vault never seals, openable from a copy
  // of the profile without the secret behind the provider.
  const capabilities: DriverCapabilities = provided
    ? { ...CAPABILITIES, nativeCryptoKey: false }
    : CAPABILITIES;

  return {
    capabilities,
    ready,

    async put(id: KeyId, material: DriverMaterial): Promise<void> {
      assertNotReserved(id);
      if (material.kind === "cryptokey") {
        await db.put<MaterialRecord>(MATERIAL_STORE, {
          id,
          kind: "cryptokey",
          privateKey: material.privateKey,
          publicKey: material.publicKey,
        });
        return;
      }
      let sealed: SealedBytes;
      try {
        sealed = await seal(host, await resolveMaster(), material.bytes);
      } finally {
        // Defence-in-depth, as in `use()`: the driver owns the buffer from
        // here, so neither a provider that rejects nor a host that rejects the
        // encrypt may leave the plaintext behind.
        material.bytes.fill(0);
      }
      await db.put<MaterialRecord>(MATERIAL_STORE, { id, kind: "bytes", ...sealed });
    },

    async use<T>(
      id: KeyId,
      _ctx: unknown,
      fn: (material: DriverMaterial) => T | Promise<T>,
    ): Promise<T> {
      const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
      if (!record) throw new KeyNotFoundError(id);
      if (record.kind === "cryptokey") {
        return fn({
          kind: "cryptokey",
          privateKey: record.privateKey,
          publicKey: record.publicKey,
        });
      }
      const bytes = await open(host, await resolveMaster(), record);
      try {
        return await fn({ kind: "bytes", bytes });
      } finally {
        // Defence-in-depth: the shims wipe injected material, but a decrypted
        // buffer must never outlive the operation regardless of the consumer.
        bytes.fill(0);
      }
    },

    /**
     * Removes a key's material and metadata. The vault master key
     * ({@link MASTER_KEY_ID}) is reserved and cannot be removed.
     */
    async remove(id: KeyId): Promise<void> {
      assertNotReserved(id);
      await db.deleteKey(id);
    },

    /**
     * Empties the keystore, removing all user keys and metadata. The vault
     * master key is preserved so that subsequently written material remains
     * openable after a reload — unless a `masterKey` provider supplies one, in
     * which case the vault's own record seals nothing this driver writes and
     * goes with everything it did seal. That is safe because the provider
     * holds the key independently of the database — but it would orphan a
     * driver still running *without* a provider over the same database.
     */
    async clear(): Promise<void> {
      await db.clear(provided ? [] : [MASTER_KEY_ID]);
    },

    async putMeta(key: Key): Promise<void> {
      assertNotReserved(key.id);
      await db.put<Key>(METADATA_STORE, key);
    },

    async getMeta(id: KeyId): Promise<Key | undefined> {
      return db.get<Key>(METADATA_STORE, id);
    },

    async listMeta(): Promise<Key[]> {
      return db.getAll<Key>(METADATA_STORE, [MASTER_KEY_ID]);
    },
  } satisfies KeyStoreDriver;
}
