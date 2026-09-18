import type {
  BaseIdentity,
  IdentitiesNamespace,
  Identity,
  IdentityStoreState,
} from "@algorandfoundation/identities-core";
import type { ExtensionOptions, Provider } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import { remoteIdentitiesMirror } from "./remote.ts";
import type { RemoteIdentitiesMirror } from "./remote.ts";

/**
 * Options for the IdentitiesConnections bridge extension.
 *
 * Narrows the shared `ExtensionOptions` registry the same way
 * `@algorandfoundation/identities-core`'s `IdentityStoreOptions` does: the
 * `identities` slice is the registered {@link IdentitiesNamespace} with the
 * `store` typed against the concrete state shape `S`, so the same options
 * object can be threaded to both `WithIdentities` and this bridge. The
 * bridge adds no fields of its own to `options.identities`.
 *
 * @template T - The identity type held by the store.
 * @template S - The full store state shape; may structurally extend
 * {@link IdentityStoreState}.
 *
 * @example
 * ```typescript
 * const options: IdentitiesConnectionsOptions = { identities: { store: identitiesStore } };
 * ```
 */
export interface IdentitiesConnectionsOptions<
  T extends BaseIdentity = Identity,
  S extends IdentityStoreState<T> = IdentityStoreState<T>,
> extends Omit<ExtensionOptions, "identities"> {
  identities?: Omit<IdentitiesNamespace, "store"> & {
    /**
     * The **shared** TanStack store instance backing the identity state:
     * the same instance passed to `WithIdentities`. Required — the
     * bridge mirrors a peer's records into the identity store, it never
     * owns one.
     */
    store?: Store<S>;
  };
}

/**
 * The surface contributed by {@link WithIdentitiesConnections}.
 *
 * @example
 * ```typescript
 * const records = provider.identity.remote.expose();
 * ```
 */
export interface IdentitiesConnectionsExtension {
  /**
   * The identities namespace member the bridge contributes.
   */
  identity: {
    /**
     * The session-scoped remote mirror (see
     * {@link import("./remote.ts").remoteIdentitiesMirror}): the surface
     * connection engines discover to exchange identity records.
     */
    remote: RemoteIdentitiesMirror;
  };
}

/**
 * Bridge extension that mounts the identity store's session-scoped
 * remote mirror at `provider.identity.remote`, the surface the
 * connections packages' `discoverDomains` duck-types to exchange
 * identity records over a session.
 *
 * Requires the shared identity store (`options.identities.store`) — the
 * same instance backing `WithIdentities` — so mirrored records ride
 * the same reactive state the local identities live in. Mounting is
 * idempotent: an already-mounted `provider.identity.remote` is reused.
 * The returned `identity` namespace carries over the members already
 * mounted on `provider.identity` (e.g. `store`), since the Provider
 * replaces the namespace wholesale; the provider itself is never spread.
 *
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The identities-connections bridge extension.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithIdentities, WithIdentitiesConnections]);
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   { identities: { store: identitiesStore } },
 * );
 * ```
 */
export const WithIdentitiesConnections = <
  T extends BaseIdentity = Identity,
  S extends IdentityStoreState<T> = IdentityStoreState<T>,
>(
  provider: Provider<any> & Partial<IdentitiesConnectionsExtension>,
  options?: IdentitiesConnectionsOptions<T, S>,
): IdentitiesConnectionsExtension => {
  const store: Store<S> | undefined = options?.identities?.store;
  if (!store) {
    throw new Error(
      "WithIdentitiesConnections requires options.identities.store (the shared identities store)",
    );
  }

  return {
    identity: {
      ...provider.identity,
      remote: provider.identity?.remote ?? remoteIdentitiesMirror<T, S>(store),
    },
  };
};
