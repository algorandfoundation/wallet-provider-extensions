/**
 * The passkeys domain types.
 *
 * A {@link Passkey} is the wallet-visible **public record** of a
 * credential: enough to render an inventory ("which passkeys does this
 * wallet hold, for which relying parties, and does the server still
 * know them?") and nothing more. Private key material NEVER crosses
 * into this store; see the note on {@link Passkey}.
 */

import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { LogStoreApi } from "@algorandfoundation/logs";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import type { ReconcileResult } from "./reconcile.ts";

/**
 * The public record of one passkey.
 *
 * Deliberately contains **no private key material**: secrets stay
 * inside their backing keystore or the native credential provider and
 * never cross into the JS store. The optional {@link Passkey.publicKey}
 * is public material only; feeders (e.g.
 * `@algorandfoundation/react-native-passkeys`' `toPasskey`) must strip
 * every private field before a record enters this shape.
 *
 * @example
 * ```typescript
 * const passkey: Passkey = {
 *   credentialId: "q2Zt...",
 *   rpId: "example.com",
 *   userName: "alice",
 *   algorithm: "P256",
 * };
 * ```
 */
export interface Passkey {
  /** The credential id (base64url, as the provider reports it). */
  credentialId: string;
  /** Human-readable display name of the passkey (e.g. `user@origin`). */
  name?: string;
  /** The public key of the credential; public material only, never private. */
  publicKey?: Uint8Array;
  /** The signing algorithm of the credential (e.g. `"P256"`). */
  algorithm?: string;
  /** The relying party identifier the passkey is bound to. */
  rpId?: string;
  /** The web origin the passkey was created for, when recorded. */
  origin?: string;
  /** Human-readable account name at the relying party. */
  userName?: string;
  /** The user handle the relying party assigned. */
  userHandle?: string;
  /** Timestamp the passkey was created. */
  createdAt?: number;
  /** Timestamp the passkey was last used to authenticate. */
  lastUsedAt?: number;
  /** Id of the wallet key the passkey was derived from, when derived. */
  parentKeyId?: string;
  /** The version of the derivation logic, pinned per credential. */
  derivationVersion?: number;
  /** The derivation scheme, pinned per credential. */
  derivationScheme?: string;
  /**
   * Result of the last server reconciliation pass: `known` when the
   * server listed the credential in its `allowCredentials`, `unknown`
   * when it did not (a stray). Absent until a reconcile runs.
   */
  serverStatus?: "known" | "unknown";
  /** Timestamp of the reconciliation pass that set {@link Passkey.serverStatus}. */
  reconciledAt?: number;
  /** Feeder-specific metadata (e.g. the backing keystore key id). */
  metadata?: Record<string, unknown>;
}

/**
 * The subset of a WebAuthn `PublicKeyCredentialRequestOptionsJSON` the
 * reconcile pass consumes. Credential ids may be base64url strings (the
 * JSON form) or raw bytes; both are normalized before comparison.
 *
 * @example
 * ```typescript
 * const serverOptions: WebAuthnRequestOptionsLike = {
 *   rpId: "example.com",
 *   allowCredentials: [{ id: "q2Zt...", type: "public-key" }],
 * };
 * ```
 */
export interface WebAuthnRequestOptionsLike {
  /** The relying party identifier the options are scoped to. */
  rpId?: string;
  /** The credential descriptors the server will accept. */
  allowCredentials?: { id: string | Uint8Array | ArrayBuffer; type?: string }[];
}

/**
 * The state of the passkeys store.
 *
 * @example
 * ```typescript
 * const store = new Store<PasskeysState>({ passkeys: [] });
 * ```
 */
export interface PasskeysState {
  /** The passkeys the store holds. */
  passkeys: Passkey[];
}

/**
 * The `options.passkeys` namespace the passkeys extensions claim on the
 * shared {@link ExtensionOptions} registry.
 *
 * This is the platform-neutral half of the two-level registry: the
 * bridge and platform packages
 * (`@algorandfoundation/passkeys-keystore-extension`,
 * `@algorandfoundation/react-native-passkeys`) **augment** this interface
 * with their own fields (e.g. `keystore`, `module`), so a composition
 * root gets one fully typed `options.passkeys` block whichever feeders
 * it installs.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/passkeys-core" {
 *   interface PasskeysNamespace {
 *     keystore?: { autoPopulate?: boolean };
 *   }
 * }
 * ```
 */
export interface PasskeysNamespace {
  /**
   * The TanStack store instance backing the passkey state; created
   * when omitted. Feeders (keystore bridges, native modules) write
   * into the same instance.
   */
  store?: Store<PasskeysState>;
  /** Hooks for intercepting passkey store operations. */
  hooks?: HookCollection<any>;
  /** Logger override; defaults to `provider.log` when mounted. */
  log?: LogStoreApi;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Passkeys-specific settings, see {@link PasskeysNamespace}. */
    passkeys?: PasskeysNamespace;
  }
}

/**
 * Options accepted by {@link import("./extension.ts").WithPasskeys}
 * under the `passkeys` key.
 *
 * The extension works with zero configuration: a fresh in-memory store
 * (and hook collection) is created when none is provided. Supply a store
 * to share passkey state with feeders or to subscribe to it from
 * application code.
 *
 * @example
 * ```typescript
 * const options: PasskeysOptions = {
 *   passkeys: { store: new Store<PasskeysState>({ passkeys: [] }) },
 * };
 * ```
 */
export interface PasskeysOptions extends ExtensionOptions {
  /** Passkeys-specific settings. */
  passkeys?: PasskeysNamespace;
}

/**
 * The extension surface contributed by the passkeys package: a reactive
 * list of the wallet's passkeys plus the store API at
 * `provider.passkey.store`.
 *
 * @example
 * ```typescript
 * console.log(provider.passkeys); // reactive inventory
 * await provider.passkey.store.addPasskey({ credentialId: "q2Zt..." });
 * ```
 */
export interface PasskeysExtension {
  /** Reactive list of the passkeys the store holds. */
  readonly passkeys: Passkey[];
  /** The `passkey` namespace the extension contributes. */
  passkey: {
    /** The passkeys store API. */
    store: PasskeysStoreApi;
  };
}

/**
 * Interface representing the passkeys store API mounted at
 * `provider.passkey.store`.
 *
 * @example
 * ```typescript
 * provider.passkey.store.hooks.before("remove", ({ credentialId }) => {
 *   console.log("removing", credentialId);
 * });
 * const { strays } = await provider.passkey.store.reconcile(serverOptions);
 * ```
 */
export interface PasskeysStoreApi {
  /**
   * Adds a passkey to the store (upsert by credential id).
   *
   * @param passkey - The passkey to add.
   * @returns The added passkey.
   */
  addPasskey: (passkey: Passkey) => Promise<Passkey>;
  /**
   * Removes a passkey from the store by its credential id.
   *
   * @param credentialId - The credential id of the passkey to remove.
   * @returns A promise that resolves when the passkey is removed.
   */
  removePasskey: (credentialId: string) => Promise<void>;
  /**
   * Retrieves a passkey from the store by its credential id.
   *
   * @param credentialId - The credential id of the passkey to retrieve.
   * @returns The passkey if found, otherwise undefined.
   */
  getPasskey: (credentialId: string) => Promise<Passkey | undefined>;
  /**
   * Retrieves all passkeys from the store.
   *
   * @returns A promise that resolves to an array of all passkeys.
   */
  getPasskeys: () => Promise<Passkey[]>;
  /**
   * Clears all passkeys from the store.
   *
   * @returns A promise that resolves when the store is cleared.
   */
  clear: () => Promise<void>;
  /**
   * Reconciles the store's inventory against server-provided WebAuthn
   * request options (see
   * {@link import("./reconcile.ts").reconcilePasskeys}), writes the
   * reconciled list back to the state, and returns the result.
   *
   * @param options - The server's {@link WebAuthnRequestOptionsLike}.
   * @returns The {@link import("./reconcile.ts").ReconcileResult}.
   */
  reconcile: (options: WebAuthnRequestOptionsLike) => Promise<ReconcileResult>;
  /**
   * The hooks for passkey store operations.
   */
  hooks: HookCollection<any>;
}
