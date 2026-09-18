import type { KeyStoreExtension, KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { createNodeKeyStore } from "./engine.ts";
import type { KeyringBinding } from "./storage/keyring.ts";
import type { MetadataFile } from "./storage/metadata.ts";

declare module "@algorandfoundation/keystore-core" {
  /**
   * Node.js additions to the shared `options.keystore` namespace: the
   * OS-keychain / sealed-metadata seams the {@link createNodeKeyStore} engine
   * needs. The reactive state store, hooks, host `subtle` and composable `shims`
   * come from the base {@link KeyStoreNamespace}.
   */
  interface KeyStoreNamespace {
    /**
     * OS-keychain binding holding secret material + the metadata master key.
     * Defaults to `@napi-rs/keyring`. Injectable for tests / alternative stores.
     */
    keyring?: KeyringBinding;
    /** Sealed-metadata file store; defaults to a filesystem store. */
    metadata?: MetadataFile;
    /** OS-keychain service every entry is filed under (default keyring only). */
    service?: string;
    /** Path of the sealed metadata file (default filesystem store only). */
    metadataPath?: string;
  }
}

/**
 * Node.js keystore extension options.
 *
 * The same {@link KeyStoreOptions} shape; this package augments the shared
 * {@link KeyStoreNamespace} with the OS-keychain / sealed-metadata seams, so
 * `options.keystore` accepts `keyring`, `metadata`, `service` and
 * `metadataPath` alongside the base `store`/`hooks`/`subtle`/`shims`.
 */
export type NodeKeystoreOptions = KeyStoreOptions;

/**
 * Wallet Provider Extension that adds Node.js Keystore functionality.
 *
 * The extension is a thin Provider/Extensions wrapper around the shared
 * {@link createNodeKeyStore} engine (OS-keychain persistence + the core
 * composable Subtle shims). There is a single code path to the keystore API:
 *
 * - If a concrete {@link import("@algorandfoundation/keystore-core").KeyStoreAPI}
 *   is injected via `options.api.keystore`, it is used as-is.
 * - Otherwise the extension **builds** the node engine from the
 *   `options.keystore` block (the reactive `store`, the `hooks` collection, an
 *   optional host `subtle`, the composable `shims`, which default to the full
 *   set, and optional keychain / metadata-file seams). The keystore hooks are
 *   applied when the engine is created, so every material-touching operation is
 *   interceptable.
 *
 * The reactive `keys`/`status` getters mirror the engine's metadata store. The
 * engine already exposes its `hooks` collection on the returned keystore, so the
 * extension surfaces `key.store` as-is without re-assigning it.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link NodeKeystoreOptions}. `options.keystore.store` and
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
  options: NodeKeystoreOptions,
) => {
  const keyStore = options.keystore.store;

  // Single source of the API: use an injected backend when present, otherwise
  // build the shared node engine and let it own every operation. The engine
  // binds the hooks at creation and exposes them as `keystore.hooks`, so no
  // re-assignment is needed here.
  const keystore =
    options?.api?.keystore ??
    createNodeKeyStore({
      store: keyStore,
      subtle: options.keystore.subtle,
      shims: options.keystore.shims,
      keyring: options.keystore.keyring,
      metadata: options.keystore.metadata,
      service: options.keystore.service,
      metadataPath: options.keystore.metadataPath,
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
