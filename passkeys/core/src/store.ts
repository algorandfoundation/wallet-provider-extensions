/**
 * Pure functions over the passkeys store.
 *
 * Mirrors the accounts-core architecture: a reactive TanStack
 * {@link Store} holds the {@link PasskeysState}, and these functions are
 * the only writers. Feeders (keystore bridges, native credential
 * providers, remote mirrors) call them to keep the inventory current;
 * the store only ever holds {@link Passkey} records with public
 * material, key secrets never cross into it.
 */

import type { Store } from "@tanstack/store";

import type { Passkey, PasskeysState } from "./types.ts";

/**
 * Adds a passkey to the store (upsert by credential id).
 *
 * An existing record with the same `credentialId` is replaced in place;
 * a new record is appended.
 *
 * @param params - The add parameters.
 * @param params.store - The TanStack store instance for {@link PasskeysState}.
 * @param params.passkey - The {@link Passkey} to add.
 * @returns The added {@link Passkey}.
 *
 * @example
 * ```typescript
 * addPasskey({ store, passkey: { credentialId: "q2Zt...", rpId: "example.com" } });
 * ```
 */
export function addPasskey({
  store,
  passkey,
}: {
  store: Store<PasskeysState>;
  passkey: Passkey;
}): Passkey {
  store.setState((state) => {
    const exists = state.passkeys.some(
      (existing) => existing.credentialId === passkey.credentialId,
    );
    const passkeys = exists
      ? state.passkeys.map((existing) =>
          existing.credentialId === passkey.credentialId ? { ...passkey } : existing,
        )
      : [...state.passkeys, { ...passkey }];
    return { ...state, passkeys };
  });
  return passkey;
}

/**
 * Removes a passkey from the store by its credential id.
 *
 * A no-op when no record with the given id exists.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link PasskeysState}.
 * @param params.credentialId - The credential id of the passkey to remove.
 *
 * @example
 * ```typescript
 * removePasskey({ store, credentialId: "q2Zt..." });
 * ```
 */
export function removePasskey({
  store,
  credentialId,
}: {
  store: Store<PasskeysState>;
  credentialId: string;
}): void {
  store.setState((state) => {
    if (!state.passkeys.some((passkey) => passkey.credentialId === credentialId)) {
      return state;
    }
    return {
      ...state,
      passkeys: state.passkeys.filter((passkey) => passkey.credentialId !== credentialId),
    };
  });
}

/**
 * Retrieves a passkey from the store by its credential id.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link PasskeysState}.
 * @param params.credentialId - The credential id of the passkey to retrieve.
 * @returns The {@link Passkey} if found, otherwise undefined.
 *
 * @example
 * ```typescript
 * const passkey = getPasskey({ store, credentialId: "q2Zt..." });
 * ```
 */
export function getPasskey({
  store,
  credentialId,
}: {
  store: Store<PasskeysState>;
  credentialId: string;
}): Passkey | undefined {
  return store.state.passkeys.find((passkey) => passkey.credentialId === credentialId);
}

/**
 * Retrieves all passkeys from the store.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link PasskeysState}.
 * @returns The {@link Passkey} records the store holds.
 *
 * @example
 * ```typescript
 * const passkeys = getPasskeys({ store });
 * ```
 */
export function getPasskeys({ store }: { store: Store<PasskeysState> }): Passkey[] {
  return store.state.passkeys;
}

/**
 * Clears all passkeys from the store.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link PasskeysState}.
 *
 * @example
 * ```typescript
 * clearPasskeys({ store });
 * ```
 */
export function clearPasskeys({ store }: { store: Store<PasskeysState> }): void {
  store.setState((state) => ({ ...state, passkeys: [] }));
}
