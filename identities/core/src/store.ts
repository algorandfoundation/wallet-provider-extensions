import type { Store } from "@tanstack/store";
import type { BaseIdentity, IdentityStoreState, DIDDocument } from "./types.ts";

/**
 * Adds an identity to the store.
 *
 * @param params - The add parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 * @param params.identity - The {@link Identity} to add.
 * @returns The added {@link Identity}.
 *
 * @example
 * ```typescript
 * const store = new Store<IdentityStoreState>({ identities: [] });
 * addIdentity({ store, identity: { address: did, type: "did:key" } });
 * ```
 */
export function addIdentity<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
  identity,
}: {
  store: Store<S>;
  identity: T;
}): T {
  store.setState((state: S): S => {
    const filtered = state.identities.filter((i) => i.address !== identity.address);
    return {
      ...state,
      identities: [identity, ...filtered],
    } as S;
  });
  return identity;
}

/**
 * Updates the DID Document of an existing identity in the store.
 *
 * @param params - The update parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 * @param params.address - The address of the identity to update.
 * @param params.didDocument - The new {@link DIDDocument} to set.
 * @returns The updated {@link Identity} if found, otherwise undefined.
 *
 * @example
 * ```typescript
 * updateIdentityDidDocument({ store, address: did, didDocument: generateDidDocument(did, publicKey) });
 * ```
 */
export function updateIdentityDidDocument<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
  address,
  didDocument,
}: {
  store: Store<S>;
  address: string;
  didDocument: DIDDocument;
}): T | undefined {
  let updatedIdentity: T | undefined;

  store.setState((state: S): S => {
    const identities = state.identities.map((identity) => {
      if (identity.address === address) {
        updatedIdentity = { ...identity, didDocument } as T;
        return updatedIdentity;
      }
      return identity;
    });

    return {
      ...state,
      identities,
    } as S;
  });

  return updatedIdentity;
}

/**
 * Shallow-merges metadata into an existing identity in the store.
 *
 * Existing `metadata` keys not present in `metadata` are kept; keys present
 * in both are overwritten by the new value. The identity object is replaced
 * (never mutated) so store subscribers observe the change.
 *
 * @param params - The update parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 * @param params.address - The address of the identity to update.
 * @param params.metadata - The metadata fields to merge into the identity's `metadata`.
 * @returns The updated {@link Identity} if found, otherwise undefined.
 *
 * @example
 * ```typescript
 * updateIdentityMetadata({ store, address: did, metadata: { anchor: { didAlgo } } });
 * ```
 */
export function updateIdentityMetadata<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
  address,
  metadata,
}: {
  store: Store<S>;
  address: string;
  metadata: Record<string, unknown>;
}): T | undefined {
  let updatedIdentity: T | undefined;

  store.setState((state: S): S => {
    const identities = state.identities.map((identity) => {
      if (identity.address === address) {
        updatedIdentity = {
          ...identity,
          metadata: { ...identity.metadata, ...metadata },
        } as T;
        return updatedIdentity;
      }
      return identity;
    });

    return {
      ...state,
      identities,
    } as S;
  });

  return updatedIdentity;
}

/**
 * Removes an identity from the store by its address.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 * @param params.address - The address of the identity to remove.
 *
 * @example
 * ```typescript
 * removeIdentity({ store, address: did });
 * ```
 */
export function removeIdentity<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
  address,
}: {
  store: Store<S>;
  address: string;
}): void {
  store.setState((state: S): S => {
    return {
      ...state,
      identities: state.identities.filter((identity) => identity.address !== address),
    } as S;
  });
}

/**
 * Retrieves an identity from the store by its address.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 * @param params.address - The address of the identity to retrieve.
 * @returns The {@link Identity} if found, otherwise undefined.
 *
 * @example
 * ```typescript
 * const identity = getIdentity({ store, address: did });
 * ```
 */
export function getIdentity<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
  address,
}: {
  store: Store<S>;
  address: string;
}): T | undefined {
  return store.state.identities.find((identity) => identity.address === address);
}

/**
 * Clears all identities from the store.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link IdentityStoreState}.
 *
 * @example
 * ```typescript
 * clearIdentities({ store });
 * ```
 */
export function clearIdentities<T extends BaseIdentity, S extends IdentityStoreState<T>>({
  store,
}: {
  store: Store<S>;
}): void {
  store.setState((state: S): S => {
    return {
      ...state,
      identities: [],
    } as S;
  });
}
