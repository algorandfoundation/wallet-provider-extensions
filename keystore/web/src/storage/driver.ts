/**
 * The IndexedDB {@link KeyStoreDriver}: the browser's "material custodian" for
 * the shared {@link createKeyStore} orchestrator.
 *
 * IndexedDB's defining capability is that it can structured-clone a
 * **non-extractable {@link CryptoKey}**, so standard-algorithm keys are
 * persisted as real keys that never become raw bytes in JS
 * ({@link DriverCapabilities.nativeCryptoKey} is `true`). Shim key material
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
import { getMasterKey, MASTER_KEY_ID, open, seal } from "./vault.ts";

/** Options for {@link createIndexedDBDriver}. */
export interface IndexedDBDriverOptions {
  /** Host Subtle used for the AES-GCM vault master key (never a shim decorator). */
  host: SubtleCrypto;
  /** IndexedDB factory; defaults to `globalThis.indexedDB`. Injectable for tests. */
  indexedDB?: IDBFactory;
  /** Database name; defaults to `"keystore"`. */
  databaseName?: string;
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
 *   once the database is open and the master key is available.
 */
export function createIndexedDBDriver(options: IndexedDBDriverOptions): KeyStoreDriver {
  const host = options.host;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? "keystore";

  let db!: KeyStoreDatabase;
  let master!: CryptoKey;

  const ready = (async (): Promise<void> => {
    db = await openDatabase(databaseName, factory);
    master = await getMasterKey(db, host);
  })();

  return {
    capabilities: CAPABILITIES,
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
      const sealed = await seal(host, master, material.bytes);
      material.bytes.fill(0);
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
      const bytes = await open(host, master, record);
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
     * openable after a reload.
     */
    async clear(): Promise<void> {
      await db.clear([MASTER_KEY_ID]);
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
