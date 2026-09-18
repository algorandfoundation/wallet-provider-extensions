/**
 * The native **feeder** between
 * `@algorandfoundation/react-native-passkey-autofill`'s native module
 * and the passkeys store of `@algorandfoundation/passkeys-core`.
 *
 * The native module is **injected** through the structural
 * {@link PasskeyAutofillModuleLike} seam (no compile-time dependency on
 * react-native), so this package builds and tests without native code.
 * {@link toPasskey} is the trust boundary: it maps a native credential
 * identity to the public {@link Passkey} shape, DROPPING every
 * key-material field; secrets never cross into the JS store.
 *
 * The feeder writes the module's credentials into the store on start
 * and on the native lifecycle events, and observes the store to
 * propagate removals of native-sourced passkeys back to
 * `deleteCredential`.
 */

import type { LogStoreApi } from "@algorandfoundation/logs";
import { addPasskey, removePasskey } from "@algorandfoundation/passkeys-core";
import type { Passkey, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Store } from "@tanstack/store";

/**
 * A credential identity as the native autofill module reports it.
 * Superset of {@link Passkey} carrying the provider-internal fields
 * (including key material) that {@link toPasskey} strips.
 *
 * @example
 * ```typescript
 * const identity: PasskeyAutofillCredentialIdentityLike = {
 *   credentialId: "q2Zt...",
 *   relyingPartyIdentifier: "example.com",
 *   userName: "alice",
 *   privateKeyBase64: "...", // dropped by toPasskey
 * };
 * ```
 */
export interface PasskeyAutofillCredentialIdentityLike {
  credentialId: string;
  relyingPartyIdentifier?: string;
  rpId?: string;
  origin?: string;
  userName?: string;
  name?: string;
  userHandle?: string;
  userId?: string;
  privateKey?: string;
  privateKeyBase64?: string;
  publicKey?: string;
  publicKeyBase64?: string;
  createdAt?: number;
  lastUsedAt?: number;
  parentKeyId?: string;
  derivationVersion?: number;
  derivationScheme?: string;
}

/**
 * The event payloads the native module emits.
 *
 * @example
 * ```typescript
 * module.addListener("onPasskeyAdded", (event: PasskeyAutofillEventPayload) => {
 *   if (event.success) console.log("added", event.credentialId);
 * });
 * ```
 */
export interface PasskeyAutofillEventPayload {
  success: boolean;
  credentialId?: string;
}

/**
 * The subset of `react-native-passkey-autofill`'s module surface this
 * feeder consumes (structural, so tests inject doubles).
 *
 * @example
 * ```typescript
 * const fake: PasskeyAutofillModuleLike = {
 *   getStoredCredentials: async () => [],
 *   deleteCredential: async () => {},
 *   clearCredentials: async () => {},
 *   isProviderActive: async () => true,
 *   openProviderSettings: async () => false,
 *   addListener: () => ({ remove() {} }),
 * };
 * ```
 */
export interface PasskeyAutofillModuleLike {
  /** Lists the credential identities the provider currently holds. */
  getStoredCredentials(): Promise<PasskeyAutofillCredentialIdentityLike[]>;
  /** Deletes one credential by id. */
  deleteCredential(credentialId: string): Promise<void>;
  /** Deletes every credential the provider holds. */
  clearCredentials(): Promise<void>;
  /** Whether this app is the device's active credential provider. */
  isProviderActive(): Promise<boolean>;
  /** Opens the OS credential/autofill provider settings screen. */
  openProviderSettings(): Promise<boolean>;
  /** Subscribes to a passkey lifecycle event of the native module. */
  addListener(
    eventName: "onPasskeyAdded" | "onPasskeyAuthenticated",
    listener: (event: PasskeyAutofillEventPayload) => void,
  ): { remove(): void };
}

/**
 * Maps a native credential identity to the public {@link Passkey}
 * shape.
 *
 * Key material (`privateKey`/`privateKeyBase64`/`publicKey`/
 * `publicKeyBase64`) and the provider-internal `userId` are DROPPED;
 * secrets never cross into the JS store. `relyingPartyIdentifier` and
 * `rpId` normalize to `rpId` (`origin` is kept separately), and
 * `userName`/`name` normalize to `userName`.
 *
 * @param identity - The native credential identity.
 * @returns The public {@link Passkey}.
 *
 * @example
 * ```typescript
 * toPasskey({ credentialId: "q2Zt...", relyingPartyIdentifier: "example.com", privateKeyBase64: "S3Y" });
 * // { credentialId: "q2Zt...", rpId: "example.com" }
 * ```
 */
export function toPasskey(identity: PasskeyAutofillCredentialIdentityLike): Passkey {
  const passkey: Passkey = { credentialId: identity.credentialId };
  const rpId = identity.relyingPartyIdentifier ?? identity.rpId;
  if (rpId !== undefined) passkey.rpId = rpId;
  if (identity.origin !== undefined) passkey.origin = identity.origin;
  const userName = identity.userName ?? identity.name;
  if (userName !== undefined) passkey.userName = userName;
  if (identity.userHandle !== undefined) passkey.userHandle = identity.userHandle;
  if (identity.createdAt !== undefined) passkey.createdAt = identity.createdAt;
  if (identity.lastUsedAt !== undefined) passkey.lastUsedAt = identity.lastUsedAt;
  if (identity.parentKeyId !== undefined) passkey.parentKeyId = identity.parentKeyId;
  if (identity.derivationVersion !== undefined) {
    passkey.derivationVersion = identity.derivationVersion;
  }
  if (identity.derivationScheme !== undefined) {
    passkey.derivationScheme = identity.derivationScheme;
  }
  return passkey;
}

/**
 * Options accepted by {@link nativePasskeysFeeder}.
 *
 * @example
 * ```typescript
 * const options: NativePasskeysFeederOptions = { module: PasskeyAutofill, store, log: provider.log };
 * ```
 */
export interface NativePasskeysFeederOptions {
  /** The injected {@link PasskeyAutofillModuleLike}. */
  module: PasskeyAutofillModuleLike;
  /** The passkeys store the feeder writes into. */
  store: Store<PasskeysState>;
  /** Optional logger (typically `provider.log`). */
  log?: LogStoreApi;
}

/**
 * The running feeder returned by {@link nativePasskeysFeeder}.
 *
 * @example
 * ```typescript
 * const feeder = nativePasskeysFeeder({ module, store });
 * await feeder.ready;
 * await feeder.refresh();
 * feeder.stop();
 * ```
 */
export interface NativePasskeysFeeder {
  /** Resolves once the initial native sync completed (even on failure). */
  ready: Promise<void>;
  /** Re-syncs the native module's credentials into the store. */
  refresh(): Promise<Passkey[]>;
  /** Unsubscribes from the native events and the store. */
  stop(): void;
}

/**
 * Starts the native passkeys feeder over the injected autofill module.
 *
 * On start (and on every `onPasskeyAdded`/`onPasskeyAuthenticated`
 * event) the module's credentials are mapped through {@link toPasskey}
 * and upserted into the store; records the module no longer reports are
 * removed. The feeder also observes the store: when a native-sourced
 * passkey (tracked by the feeder's own credential-id snapshot)
 * disappears from the state, the backing native credential is deleted
 * via `deleteCredential`. Both directions are loop-guarded through the
 * snapshot, so a native-side deletion synced by `refresh` never
 * re-fires `deleteCredential` and vice versa.
 *
 * @param options - {@link NativePasskeysFeederOptions}.
 * @returns The {@link NativePasskeysFeeder}.
 *
 * @example
 * ```typescript
 * import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";
 *
 * const feeder = nativePasskeysFeeder({ module: PasskeyAutofill, store });
 * await feeder.ready;
 * ```
 */
export function nativePasskeysFeeder(options: NativePasskeysFeederOptions): NativePasskeysFeeder {
  const { module, store, log } = options;
  /** Snapshot of the credential ids the feeder owns (native-sourced). */
  const nativeIds = new Set<string>();

  const refresh = async (): Promise<Passkey[]> => {
    const identities = await module.getStoredCredentials();
    const passkeys = identities.map(toPasskey);
    const listed = new Set(passkeys.map((passkey) => passkey.credentialId));
    // Native-side deletions: drop records the module no longer reports.
    // The id leaves the snapshot BEFORE the store write, so the store
    // observer below never echoes the removal back to the module.
    for (const credentialId of nativeIds) {
      if (listed.has(credentialId)) continue;
      nativeIds.delete(credentialId);
      removePasskey({ store, credentialId });
    }
    for (const passkey of passkeys) {
      nativeIds.add(passkey.credentialId);
      // Merge over the existing record so store-side fields the module
      // does not know (e.g. `serverStatus` from a reconcile) survive.
      const existing = store.state.passkeys.find(
        (candidate) => candidate.credentialId === passkey.credentialId,
      );
      addPasskey({ store, passkey: existing ? { ...existing, ...passkey } : passkey });
    }
    return passkeys;
  };

  const onEvent = (): void => {
    void refresh().catch((e) => {
      log?.warn(`refresh after native event failed: ${String(e)}`, {}, "NativePasskeysFeeder");
    });
  };
  const nativeSubscriptions = [
    module.addListener("onPasskeyAdded", onEvent),
    module.addListener("onPasskeyAuthenticated", onEvent),
  ];

  // Store observer: a native-sourced passkey removed from the state
  // (UI removal, clear) deletes the backing native credential. The id
  // leaves the snapshot first, so the native event triggered by the
  // deletion cannot re-fire it.
  const subscription = store.subscribe(() => {
    const present = new Set(store.state.passkeys.map((passkey) => passkey.credentialId));
    for (const credentialId of nativeIds) {
      if (present.has(credentialId)) continue;
      nativeIds.delete(credentialId);
      void module.deleteCredential(credentialId).catch((e) => {
        log?.warn(
          `deleteCredential for removed passkey failed: ${String(e)}`,
          {},
          "NativePasskeysFeeder",
        );
      });
    }
  });

  const ready: Promise<void> = (async () => {
    try {
      await refresh();
    } catch (e) {
      log?.warn(`initial native sync failed: ${String(e)}`, {}, "NativePasskeysFeeder");
    }
  })();

  return {
    ready,
    refresh,
    stop(): void {
      for (const nativeSubscription of nativeSubscriptions) nativeSubscription.remove();
      subscription.unsubscribe();
    },
  };
}

// Metro (React Native) transforms this module to CJS, so `require` exists
// at runtime; under Node ESM (tests, tooling) it does not and the lazy
// lookup below degrades to `undefined`.
declare const require: ((id: string) => unknown) | undefined;

/**
 * Lazily resolves the default export of
 * `@algorandfoundation/react-native-passkey-autofill`, when the
 * (optional peer) package is installed and a CJS `require` exists in
 * the host runtime. Resolves `undefined` otherwise; callers then
 * inject the module explicitly.
 *
 * @returns The native module, or `undefined` when not resolvable.
 *
 * @example
 * ```typescript
 * const module = options.passkeys?.module ?? defaultPasskeyAutofillModule();
 * if (!module) throw new Error("pass the native module via passkeys.module");
 * ```
 */
export function defaultPasskeyAutofillModule(): PasskeyAutofillModuleLike | undefined {
  try {
    if (typeof require !== "function") return undefined;
    const resolved = require("@algorandfoundation/react-native-passkey-autofill") as
      | { default?: unknown }
      | undefined;
    const candidate =
      resolved && typeof resolved === "object" && "default" in resolved
        ? resolved.default
        : resolved;
    // Validate by shape: bundler require shims can resolve to anything.
    if (
      candidate &&
      typeof (candidate as PasskeyAutofillModuleLike).getStoredCredentials === "function"
    ) {
      return candidate as PasskeyAutofillModuleLike;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
