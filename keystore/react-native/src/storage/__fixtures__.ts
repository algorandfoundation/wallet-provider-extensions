/**
 * Shared test fixtures for the Keychain/MMKV storage surface.
 *
 * Excluded from the published build (see `tsconfig.build.json`) — these are
 * test-only helpers and must never ship in `dist/`.
 */

import { MasterKeyNotFoundError } from "../errors.ts";
import type { KeystoreMigrationContext } from "../types.ts";
import type { KeychainStorage } from "./driver.ts";

/** A fresh in-memory MMKV-style store per test (real Keychain master is mocked). */
export function memoryStorage(): KeychainStorage & { entries(): [string, string][] } {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    getAllKeys: () => [...map.keys()],
    entries: () => [...map.entries()],
  };
}

/**
 * A {@link KeystoreMigrationContext} over `storage` for driving migration
 * revisions in tests. By default `masterKeyForRead` reports that no master key
 * exists (the fresh-install case); pass an override for tests that exercise
 * material adoption.
 */
export function migrationContext(
  storage: KeychainStorage,
  overrides: Partial<KeystoreMigrationContext> = {},
): KeystoreMigrationContext {
  return {
    storage,
    subtle: globalThis.crypto.subtle,
    masterKeyForRead: async () => {
      throw new MasterKeyNotFoundError();
    },
    ...overrides,
  };
}

/** Seeds a legacy passkey metadata record (pre-dp256-split, no `scheme`). */
export function seedLegacyPasskey(storage: KeychainStorage, id: string): void {
  storage.set(
    `k/${id}`,
    JSON.stringify({
      id,
      type: "hd-derived-p256",
      algorithm: "P256",
      extractable: false,
      keyUsages: ["sign", "verify"],
      metadata: {
        storage: "none",
        origin: "https://example.com",
        userHandle: "user-123",
        counter: 0,
        parentKeyId: "xhd-root-1",
      },
      version: 1,
    }),
  );
}
