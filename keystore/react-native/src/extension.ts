import type { KeyStoreExtension } from "@algorandfoundation/keystore-core";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { createReactNativeKeyStore } from "./engine.ts";
import type { ReactKeystoreOptions } from "./types.ts";

/**
 * Wallet Provider Extension that adds Keystore functionality.
 *
 * The extension is a thin Provider/Extensions wrapper around the shared
 * {@link createReactNativeKeyStore} engine. There is a single code path to the
 * keystore API:
 *
 * - If a concrete {@link import("@algorandfoundation/keystore-core").KeyStoreAPI}
 *   is injected via `options.api.keystore`, it is used as-is.
 * - Otherwise the extension **builds** the React Native engine from the
 *   `options.keystore` block (the reactive `store`, the `hooks` collection, the
 *   host `subtle`, the composable `shims`, an optional MMKV `storage`, and a
 *   default `authentication` policy). The keystore hooks are applied when the
 *   engine is created, so every material-touching operation is interceptable.
 *
 * The reactive `keys`/`status` getters mirror the engine's metadata store. The
 * engine already exposes its `hooks` collection on the returned keystore, so the
 * extension surfaces `key.store` as-is without re-assigning it.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link ReactKeystoreOptions}. `options.keystore.store` and
 *   `options.keystore.hooks` are required; the crypto bindings are required only
 *   when the extension builds the engine itself.
 *
 * @returns The {@link KeyStoreExtension} surface with reactive `keys`/`status`
 *   and the `key.store` keystore API (which already exposes `hooks` when the
 *   engine was built with them).
 *
 * @example
 * ```typescript
 * const ProviderWithKeystore = Provider.withExtensions([WithKeyStore]);
 * const provider = new ProviderWithKeystore({
 *   keystore: {
 *     store,
 *     hooks,
 *     subtle,
 *     shims: [(host) => withSubtleXHD(host, xhd), (host) => withSubtleFalcon1024(host, falcon)],
 *   },
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
  options: ReactKeystoreOptions,
) => {
  const keyStore = options.keystore.store;

  // Single source of the API: use an injected backend when present, otherwise
  // build the shared React Native engine and let it own every operation. The
  // engine binds the hooks at creation and exposes them as `keystore.hooks`, so
  // no re-assignment is needed here.
  const keystore =
    options?.api?.keystore ??
    createReactNativeKeyStore({
      store: keyStore,
      subtle: options.keystore.subtle as SubtleCrypto,
      shims: options.keystore.shims,
      storage: options.keystore.storage,
      hooks: options.keystore.hooks,
      authentication: options.keystore.authentication,
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
