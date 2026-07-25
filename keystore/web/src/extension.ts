import type { KeyStoreExtension, KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { createWebKeyStore } from "./engine.ts";

/**
 * Browser keystore extension options.
 *
 * Extends the base {@link KeyStoreOptions} `keystore` block with the pieces the
 * {@link createWebKeyStore} engine needs, following the Provider/Extensions
 * pattern: the reactive state store, hooks, host `subtle` and composable `shims`
 * come from the base options, while the IndexedDB seams are injected here.
 */
export interface WebKeystoreOptions extends KeyStoreOptions {
  keystore: KeyStoreOptions["keystore"] & {
    /** IndexedDB factory; defaults to `globalThis.indexedDB`. Injectable for tests. */
    indexedDB?: IDBFactory;
    /** Database name; defaults to `"keystore"`. */
    databaseName?: string;
  };
}

/**
 * Wallet Provider Extension that adds browser Keystore functionality.
 *
 * The extension is a thin Provider/Extensions wrapper around the shared
 * {@link createWebKeyStore} engine (IndexedDB persistence + the core composable
 * Subtle shims). There is a single code path to the keystore API:
 *
 * - If a concrete {@link import("@algorandfoundation/keystore-core").KeyStoreAPI}
 *   is injected via `options.api.keystore`, it is used as-is.
 * - Otherwise the extension **builds** the browser engine from the
 *   `options.keystore` block (the reactive `store`, the `hooks` collection, an
 *   optional host `subtle`, the composable `shims` — which default to the full
 *   set — and optional IndexedDB seams). The keystore hooks are applied when the
 *   engine is created, so every material-touching operation is interceptable.
 *
 * The reactive `keys`/`status` getters mirror the engine's metadata store. The
 * engine already exposes its `hooks` collection on the returned keystore, so the
 * extension surfaces `key.store` as-is without re-assigning it.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link WebKeystoreOptions}. `options.keystore.store` and
 *   `options.keystore.hooks` are required.
 *
 * @returns The {@link KeyStoreExtension} surface with reactive `keys`/`status`
 *   and the `key.store` keystore API (which already exposes `hooks` when the
 *   engine was built with them).
 *
 * @example
 * ```typescript
 * const ProviderWithKeystore = Provider.withExtensions([WithKeyStore]);
 * const provider = new ProviderWithKeystore({
 *   keystore: { store, hooks },
 * });
 *
 * // Intercept operations
 * provider.key.store.hooks.before("sign", ({ args }) => {
 *   console.log("About to sign", args);
 * });
 * ```
 */
export const WithKeyStore: Extension<KeyStoreExtension> = (
  _provider: Provider<any> & Partial<LogStoreExtension>,
  options: WebKeystoreOptions,
) => {
  const keyStore = options.keystore.store;

  // Single source of the API: use an injected backend when present, otherwise
  // build the shared browser engine and let it own every operation. The engine
  // binds the hooks at creation and exposes them as `keystore.hooks`, so no
  // re-assignment is needed here.
  const keystore =
    options?.api?.keystore ??
    createWebKeyStore({
      store: keyStore,
      subtle: options.keystore.subtle,
      shims: options.keystore.shims,
      indexedDB: options.keystore.indexedDB,
      databaseName: options.keystore.databaseName,
      hooks: options.keystore.hooks,
    });

  return {
    /** Reactive state of all keys in the keystore. */
    get keys() {
      return keyStore.state.keys;
    },
    /** Reactive status of the keystore (e.g. 'idle', 'signing'). */
    get status() {
      return keyStore.state.status;
    },
    /**
     * Reactive list of the composable algorithm add-ons ("shims") active on this
     * keystore (e.g. `"Falcon-1024"`), populated once the engine is ready.
     */
    get algorithms() {
      return keyStore.state.algorithms ?? [];
    },
    /**
     * The Keystore API for performing cryptographic operations. The engine
     * already exposes the `hooks` collection used to intercept operations.
     */
    key: {
      store: keystore,
    },
  } as KeyStoreExtension;
};
