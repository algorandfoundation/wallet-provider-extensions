import type { KeyStoreExtension } from "@algorandfoundation/keystore-core";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { createReactNativeKeyStore } from "./engine.ts";
import { migrations } from "./migrations/index.ts";
import { storage as defaultStorage } from "./storage/state.ts";
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
 * @param provider - The host provider (may carry `log` and `migrations`
 *   extensions). When a `migrations` extension is present, this package's
 *   revisions (see `./migrations/index.ts`) are registered against it and the
 *   engine defers hydration until they have run.
 * @param options - {@link ReactKeystoreOptions}. `options.keystore.store` and
 *   `options.keystore.hooks` are required; the crypto bindings are required only
 *   when the extension builds the engine itself.
 *
 * @returns The {@link KeyStoreExtension} surface with reactive `keys`/`status`
 *   and the `key.store` keystore API (which already exposes `hooks` when the
 *   engine was built with them).
 *
 * @remarks
 * Migration registration (`migrationsApi?.register(...)`) always runs,
 * regardless of which code path above supplies the keystore API — but the
 * `before` gate (which sequences `createReactNativeKeyStore`'s hydration
 * behind `provider.migrations?.ready`) only exists on the engine-building
 * path. When `options.api.keystore` is injected, `createReactNativeKeyStore`
 * is never called, so that gate never exists: this package's migrations
 * still run against `options.keystore.storage ?? defaultStorage`, but with no
 * ordering guarantee relative to the injected backend. A consumer who injects
 * `options.api.keystore` owns sequencing the injected backend against
 * `provider.migrations.ready` itself.
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
  provider: Provider<any> & Partial<LogStoreExtension>,
  options: ReactKeystoreOptions,
) => {
  const keyStore = options.keystore.store;
  const storage = options.keystore.storage ?? defaultStorage;

  // Opt-in: a no-op unless the provider carries a migrations extension. That
  // is silent by design (see `register`'s no-op contract), but silent opt-in
  // for a whole feature is easy to misconfigure — `WithMigrations` must be
  // installed *first* in the extensions array, and getting that wrong yields
  // no registration, no gate and no error. This can't be detected from inside
  // `WithMigrations` itself (it runs before every other extension), so the
  // cheap check lives here instead: warn once, when there is something this
  // package would have registered.
  const migrationsApi = (provider as any)?.migrations;
  if (!migrationsApi && migrations.length > 0) {
    provider.log?.warn(
      "@algorandfoundation/react-native-keystore has data migrations to run, but no " +
        "`migrations` extension is installed on the provider. Add `WithMigrations` from " +
        '"@algorandfoundation/provider-migrations" — first — in the provider\'s extensions ' +
        "array, or these migrations will never run.",
      { module: "@algorandfoundation/react-native-keystore" },
    );
  }
  migrationsApi?.register({
    module: "@algorandfoundation/react-native-keystore",
    context: () => storage,
    migrations,
  });

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
      storage,
      hooks: options.keystore.hooks,
      authentication: options.keystore.authentication,
      before: migrationsApi?.ready,
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
