import type { CredentialKeyValueStore } from "@algorandfoundation/credentials-core";

/**
 * A {@link CredentialKeyValueStore} backed by the browser's `localStorage`
 * (or any other `Storage` implementation, e.g. `sessionStorage`).
 *
 * This is the default persistence driver the browser `WithCredentials`
 * extension hands to the core `createCredentialStore` engine; it is the
 * IndexedDB analogue of how `keystore-web` supplies its storage driver.
 *
 * @param storage - The backing `Storage`; defaults to `globalThis.localStorage`.
 * @returns A {@link CredentialKeyValueStore} over the given storage.
 *
 * @example
 * ```typescript
 * const { api, ready } = createCredentialStore({
 *   driver: localStorageCredentialDriver(sessionStorage),
 * });
 * ```
 */
export function localStorageCredentialDriver(
  storage: Storage = globalThis.localStorage,
): CredentialKeyValueStore {
  return {
    get(key: string): string | null {
      return storage.getItem(key);
    },
    set(key: string, value: string): void {
      storage.setItem(key, value);
    },
  };
}
