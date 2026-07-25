/**
 * A minimal promise-based wrapper over IndexedDB used by the browser keystore
 * storage engine.
 *
 * IndexedDB is the browser's structured, transactional key/value store. Its
 * defining capability for a keystore is that it can **structured-clone
 * non-extractable {@link CryptoKey} objects**: standard-algorithm keys can be
 * persisted as real, non-exportable keys that never exist as raw bytes in JS.
 * Shim keys (BIP32-Ed25519 roots, Falcon private keys) and raw seeds cannot be
 * structured-cloned, so those are stored as bytes encrypted at rest (see
 * `./vault.ts`).
 *
 * The factory is injectable so the engine can be exercised in a non-browser
 * test environment (e.g. `fake-indexeddb`).
 */

import type { KeyId } from "@algorandfoundation/keystore-core";

/** Object store holding UI-safe {@link import("@algorandfoundation/keystore-core").Key} metadata. */
export const METADATA_STORE = "metadata";

/** Object store holding the secret material for each key (a {@link MaterialRecord}). */
export const MATERIAL_STORE = "material";

/**
 * A persisted secret for a single key.
 *
 * - `cryptokey` — a genuine non-extractable {@link CryptoKey} structured-cloned
 *   into IndexedDB. Used for standard host algorithms (Ed25519, ECDSA, AES, …)
 *   so private material never materialises as bytes in JS.
 * - `bytes` — AES-GCM ciphertext (with its IV) for material that cannot be a
 *   `CryptoKey`: shim key material (BIP32-Ed25519 roots, Falcon private keys)
 *   and raw BIP39 seeds. Encrypted at rest with the vault master key.
 */
export type MaterialRecord =
  | { id: KeyId; kind: "cryptokey"; privateKey: CryptoKey; publicKey?: CryptoKey }
  | { id: KeyId; kind: "bytes"; iv: Uint8Array; ciphertext: Uint8Array };

/**
 * Opens (creating/upgrading as needed) the keystore IndexedDB database and
 * returns a small promise-based handle over it.
 *
 * @param name - The database name (allows isolating multiple keystores).
 * @param factory - The {@link IDBFactory} to use; defaults to the global
 *   `indexedDB`. Injectable for tests.
 * @returns A {@link KeyStoreDatabase} handle.
 */
export async function openDatabase(name: string, factory: IDBFactory): Promise<KeyStoreDatabase> {
  const db = await request<IDBDatabase>(
    ((): IDBOpenDBRequest => {
      const open = factory.open(name, 1);
      open.onupgradeneeded = (): void => {
        const database = open.result;
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          database.createObjectStore(METADATA_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(MATERIAL_STORE)) {
          database.createObjectStore(MATERIAL_STORE, { keyPath: "id" });
        }
      };
      return open;
    })(),
  );
  return new KeyStoreDatabase(db);
}

/**
 * A thin, promise-based handle over an open keystore {@link IDBDatabase}.
 */
export class KeyStoreDatabase {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  /** Reads a single record from a store, or `undefined` when absent. */
  async get<T>(store: string, id: string): Promise<T | undefined> {
    const tx = this.#db.transaction(store, "readonly");
    const value = await request<T | undefined>(tx.objectStore(store).get(id));
    return value ?? undefined;
  }

  /** Reads every record from a store, optionally excluding specific IDs. */
  async getAll<T extends { id: string }>(store: string, exclude: string[] = []): Promise<T[]> {
    const tx = this.#db.transaction(store, "readonly");
    const all = await request<T[]>(tx.objectStore(store).getAll());
    if (exclude.length === 0) return all;
    const excluded = new Set(exclude);
    return all.filter((r) => !excluded.has(r.id));
  }

  /** Writes (inserts or replaces) a record into a store. */
  async put<T>(store: string, value: T): Promise<void> {
    const tx = this.#db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await done(tx);
  }

  /** Deletes a record from a store by id. */
  async delete(store: string, id: string): Promise<void> {
    const tx = this.#db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await done(tx);
  }

  /** Removes an id from **both** the metadata and material stores atomically. */
  async deleteKey(id: string): Promise<void> {
    const tx = this.#db.transaction([METADATA_STORE, MATERIAL_STORE], "readwrite");
    tx.objectStore(METADATA_STORE).delete(id);
    tx.objectStore(MATERIAL_STORE).delete(id);
    await done(tx);
  }

  /**
   * Empties both object stores.
   *
   * Material IDs in the `preserve` list are kept in the {@link MATERIAL_STORE}.
   * The {@link METADATA_STORE} is always cleared completely.
   *
   * @param preserve - Material IDs to preserve.
   */
  async clear(preserve: string[] = []): Promise<void> {
    const tx = this.#db.transaction([METADATA_STORE, MATERIAL_STORE], "readwrite");
    tx.objectStore(METADATA_STORE).clear();

    const materialStore = tx.objectStore(MATERIAL_STORE);
    if (preserve.length === 0) {
      materialStore.clear();
    } else {
      const allKeys = await request<IDBValidKey[]>(materialStore.getAllKeys());
      const preserved = new Set(preserve);
      for (const key of allKeys) {
        if (typeof key === "string" && !preserved.has(key)) {
          materialStore.delete(key);
        }
      }
    }
    await done(tx);
  }

  /** Closes the underlying database connection. */
  close(): void {
    this.#db.close();
  }
}

/** Resolves an {@link IDBRequest} to its result (or rejects with its error). */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolves once an {@link IDBTransaction} commits (or rejects on error/abort). */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = (): void => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
