import type { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import {
  addIdentity,
  clearIdentities,
  getIdentity,
  removeIdentity,
  updateIdentityDidDocument,
  updateIdentityMetadata,
} from "./store.ts";
import type {
  BaseIdentity,
  DIDDocument,
  Identity,
  IdentityStoreExtension,
  IdentityStoreOptions,
  IdentityStoreState,
} from "./types.ts";

/**
 * Extension that adds identity management capabilities to a Provider.
 *
 * This is the **store-only** extension: it mounts the reactive `identities`
 * getter and the `identity.store` API ({@link IdentityStoreApi}) over the
 * `options.identities.store` / `options.identities.hooks` block, creating a
 * fresh in-memory store and hook collection when they are omitted. The
 * bridges (keystore, connections, intermezzo) layer on top of this surface;
 * the `@algorandfoundation/identities` meta package exports a **composed**
 * `WithIdentities` that mounts the core store together with the bridges.
 *
 * Mirrors the accounts store's generic seat: the store holds any union of
 * {@link BaseIdentity} subtypes (local keystore-backed, remote wallet-synced,
 * …) which consumers narrow back via `type` or a `metadata` discriminant.
 *
 * Mounting is idempotent: an `identity.store` already present on the
 * provider is reused, so a bridge mounted earlier keeps its API object.
 *
 * @template T - The identity type held by the store.
 * @template S - The full store state shape.
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The identity store extension.
 *
 * @example
 * ```typescript
 * import { Provider } from "@algorandfoundation/wallet-provider";
 * import { WithIdentities } from "@algorandfoundation/identities-core";
 *
 * const MyProvider = Provider.withExtensions([WithIdentities]);
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   { identities: { store: identityStore, hooks: identityHooks } },
 * );
 * await provider.identity.store.addIdentity({ address: did, type: "did:key" });
 * ```
 */
export const WithIdentities = <
  T extends BaseIdentity = Identity,
  S extends IdentityStoreState<T> = IdentityStoreState<T>,
>(
  provider: Provider<any> & Partial<IdentityStoreExtension<T>>,
  options?: IdentityStoreOptions<T, S>,
): IdentityStoreExtension<T> => {
  const store: Store<S> =
    options?.identities?.store ??
    (new Store<IdentityStoreState<T>>({ identities: [] }) as Store<S>);
  const hooks = options?.identities?.hooks ?? new Hook.Collection<any>();

  return {
    get identities() {
      return store.state.identities;
    },
    identity: {
      store: provider?.identity?.store || {
        async addIdentity(identity: T): Promise<T> {
          return hooks("add", addIdentity<T, S>, { store, identity });
        },
        async removeIdentity(address: string): Promise<void> {
          return hooks("remove", removeIdentity<T, S>, { store, address });
        },
        async getIdentity(address: string): Promise<T | undefined> {
          return hooks("get", getIdentity<T, S>, { store, address });
        },
        async clear(): Promise<void> {
          return hooks("clear", clearIdentities<T, S>, { store });
        },
        async updateDidDocument(address: string, didDocument: DIDDocument): Promise<T | undefined> {
          return hooks("updateDidDocument", updateIdentityDidDocument<T, S>, {
            store,
            address,
            didDocument,
          });
        },
        async updateIdentityMetadata(
          address: string,
          metadata: Record<string, unknown>,
        ): Promise<T | undefined> {
          return hooks("updateMetadata", updateIdentityMetadata<T, S>, {
            store,
            address,
            metadata,
          });
        },
        hooks,
      },
    },
  } as IdentityStoreExtension<T>;
};
