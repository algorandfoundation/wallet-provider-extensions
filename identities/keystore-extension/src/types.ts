import type {
  IdentitiesNamespace,
  IdentityStoreApi,
  IdentityStoreState,
  DIDDocument,
} from "@algorandfoundation/identities-core";
import type { KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

/**
 * The bridge-specific block this package adds to `options.identities`
 * (see {@link IdentitiesNamespace}).
 *
 * @example
 * ```typescript
 * const options = { identities: { store, keystore: { autoPopulate: false } } };
 * ```
 */
export interface IdentitiesKeystoreNamespace {
  /**
   * Automatically populate the identity store from the keystore: every
   * `hd-derived-ed25519` key with `metadata.context === 1` becomes an
   * identity, and the identities' DID documents follow the seed hierarchy.
   * @default true
   */
  autoPopulate?: boolean;
}

declare module "@algorandfoundation/identities-core" {
  /**
   * Keystore-bridge additions to the shared `options.identities` namespace.
   */
  interface IdentitiesNamespace {
    /** Keystore-bridge settings, see {@link IdentitiesKeystoreNamespace}. */
    keystore?: IdentitiesKeystoreNamespace;
  }
}

/**
 * Options for the {@link WithIdentitiesKeystore} extension.
 *
 * Narrows the shared registry: the bridge needs the concrete
 * `options.identities.store` (the same instance handed to `WithIdentities`)
 * and the `options.keystore` block (`store` at least) to subscribe to key
 * changes. The `identities.hooks` and `identities.keystore` fields stay
 * optional.
 *
 * @example
 * ```typescript
 * const options: IdentitiesKeystoreExtensionOptions = {
 *   keystore: { store: keyStore, hooks: keyHooks },
 *   identities: { store: identityStore, keystore: { autoPopulate: true } },
 * };
 * ```
 */
export interface IdentitiesKeystoreExtensionOptions extends KeyStoreOptions {
  identities: IdentitiesNamespace & {
    /**
     * The TanStack store instance backing the identity state.
     */
    store: Store<IdentityStoreState>;
  };
}

/**
 * The surface contributed by {@link WithIdentitiesKeystore}: it extends the
 * mounted `identity.store` API with `restoreFromDidDocument`.
 *
 * @example
 * ```typescript
 * await provider.identity.store.restoreFromDidDocument(backupDocument);
 * ```
 */
export interface IdentitiesKeystoreExtension {
  identity: {
    store: IdentityStoreApi & {
      /**
       * Recreates the keystore state (derived keys) based on the provided DID Document.
       * @param doc The DID Document to restore from.
       */
      restoreFromDidDocument: (doc: DIDDocument) => Promise<void>;
    };
  };
}
