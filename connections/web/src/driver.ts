import type { ConnectionKeyValueStore } from "@algorandfoundation/connections-core";

/**
 * A {@link ConnectionKeyValueStore} backed by `window.localStorage`, the
 * browser default persistence driver for the connections store.
 *
 * @returns The localStorage-backed driver.
 *
 * @example
 * ```typescript
 * const { api, ready } = createConnectionsStore({ driver: localStorageConnectionDriver() });
 * ```
 */
export function localStorageConnectionDriver(): ConnectionKeyValueStore {
  return {
    get(key: string): string | null {
      return globalThis.localStorage.getItem(key);
    },
    set(key: string, value: string): void {
      globalThis.localStorage.setItem(key, value);
    },
  };
}
