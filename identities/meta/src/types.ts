import type { Store } from "@tanstack/store";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type {
  BaseIdentity,
  IdentitiesNamespace,
  Identity,
  IdentityStoreApi,
  IdentityStoreExtension,
  IdentityStoreState,
  DIDDocument,
} from "@algorandfoundation/identities-core";
import type { RemoteIdentitiesMirror } from "@algorandfoundation/identities-connections-extension";

/**
 * Options for the composed {@link WithIdentities} extension.
 *
 * Narrows the shared `ExtensionOptions` registry: `options.identities` is
 * the registered {@link IdentitiesNamespace} (`store`, `hooks`, plus the
 * `keystore.autoPopulate` block the keystore bridge adds) with the `store`
 * typed against the concrete identity union `T`. `options.keystore` comes
 * from `@algorandfoundation/keystore-core`'s registration and is only read
 * when the provider carries a keystore.
 *
 * @template T - The identity type held by the store.
 *
 * @example
 * ```typescript
 * const options: IdentitiesExtensionOptions = {
 *   identities: { store: identityStore, keystore: { autoPopulate: true } },
 *   keystore: { store: keyStore, hooks: keyHooks },
 * };
 * ```
 */
export interface IdentitiesExtensionOptions<T extends BaseIdentity = Identity> extends Omit<
  ExtensionOptions,
  "identities"
> {
  identities?: Omit<IdentitiesNamespace, "store"> & {
    /** The TanStack store instance backing the identity state. */
    store?: Store<IdentityStoreState<T>>;
  };
}

/**
 * Interface representing the unified Identities extension.
 *
 * @template T - The identity type held by the store.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithKeyStore, WithIdentities]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, options);
 * await provider.identity.store.ready;
 * await provider.identity.store.restoreFromDidDocument(backupDocument);
 * ```
 */
export interface IdentitiesExtension<
  T extends BaseIdentity = Identity,
> extends IdentityStoreExtension<T> {
  identity: {
    store: IdentityStoreApi<T> & {
      restoreFromDidDocument(doc: DIDDocument): Promise<void>;
      /**
       * Resolves once **all** of this extension's dynamic bridge imports
       * have settled — the keystore bridge (when `provider.key.store` is
       * present) and the connections bridge — mounted, or swallowed when
       * a peer is not installed. The identities counterpart of the
       * keystore's `KeyStore.ready`. Never rejects. After it resolves,
       * `provider.identity.remote` is present whenever
       * `@algorandfoundation/identities-connections-extension` is
       * installed, so `await provider.identity.store.ready` before
       * initiating a connection guarantees the first handshake exchanges
       * records instead of degrading to announce-only.
       */
      ready: Promise<void>;
    };
    /**
     * The session-scoped remote mirror contributed by the connections
     * bridge: the surface connection engines discover to exchange
     * identity records. Attached asynchronously once
     * `@algorandfoundation/identities-connections-extension` resolves;
     * absent when the peer is not installed.
     */
    remote?: RemoteIdentitiesMirror;
  };
}
