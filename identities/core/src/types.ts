import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * The `options.identities` namespace the identities extensions claim on the
 * shared {@link ExtensionOptions} registry.
 *
 * This is the store half of the two-level registry: the bridge packages
 * (`@algorandfoundation/identities-keystore-extension`,
 * `@algorandfoundation/identities-connections-extension`, …) **augment**
 * this interface with their own fields (e.g. `keystore.autoPopulate`), so a
 * composition root gets one fully typed `options.identities` block whichever
 * bridges it installs. Both fields are optional: {@link WithIdentities}
 * creates a fresh in-memory store and hook collection when they are omitted.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/identities-core" {
 *   interface IdentitiesNamespace {
 *     keystore?: { autoPopulate?: boolean };
 *   }
 * }
 * ```
 */
export interface IdentitiesNamespace {
  /**
   * The TanStack store instance backing the identity state. Share the same
   * instance with every bridge that mirrors into the identity store.
   */
  store?: Store<IdentityStoreState>;

  /**
   * Hooks for intercepting identity store operations (`add`, `remove`, `get`,
   * `clear`, `updateDidDocument`, `updateMetadata`).
   */
  hooks?: HookCollection<any>;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Identities-specific settings, see {@link IdentitiesNamespace}. */
    identities?: IdentitiesNamespace;
  }
}

/**
 * Options for the {@link WithIdentities} extension.
 *
 * Narrows the shared {@link ExtensionOptions} registry so the `identities`
 * block is typed against the concrete identity union `T` and state shape `S`
 * instead of the registry's default {@link IdentitiesNamespace}.
 *
 * @template T - The identity type held by the store; a union of
 * {@link BaseIdentity} subtypes narrowed by their discriminants (e.g.
 * `type` or a `metadata` tag), mirroring the accounts store's generic seat.
 * @template S - The full store state shape; may structurally extend
 * {@link IdentityStoreState}.
 *
 * @example
 * ```typescript
 * const options: IdentityStoreOptions<MyIdentity> = {
 *   identities: { store: new Store<IdentityStoreState<MyIdentity>>({ identities: [] }) },
 * };
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, options);
 * ```
 */
export interface IdentityStoreOptions<
  T extends BaseIdentity = Identity,
  S extends IdentityStoreState<T> = IdentityStoreState<T>,
> extends Omit<ExtensionOptions, "identities"> {
  identities?: Omit<IdentitiesNamespace, "store"> & {
    /**
     * The TanStack store instance backing the identity state.
     */
    store?: Store<S>;
  };
}

/**
 * The open union of identity kinds: `"did:key"` for self-describing DIDs,
 * `"xhd"` for legacy HD-derived identities, or any bridge-specific tag.
 *
 * @example
 * ```typescript
 * const type: IdentityType = "did:key";
 * ```
 */
export type IdentityType = "xhd" | "did:key" | string;

/**
 * W3C DID Document structure.
 *
 * @example
 * ```typescript
 * const doc: DIDDocument = generateDidDocument(did, publicKey);
 * doc.service.push({ id: `${did}#hub`, type: "MessagingService", serviceEndpoint: "https://hub.example" });
 * ```
 */
export interface DIDDocument {
  "@context": string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  /**
   * Ids of the verification methods usable for key agreement (ECDH).
   * For Ed25519 `did:key` identities this is the X25519 twin of the
   * signing key; peers use it to derive a shared encryption key.
   */
  keyAgreement?: string[];
  service: Service[];
}

/**
 * Verification Method for DID Document.
 *
 * @example
 * ```typescript
 * const method: VerificationMethod = {
 *   id: `${did}#key-1`,
 *   type: "Ed25519VerificationKey2020",
 *   controller: did,
 *   publicKeyMultibase: "z6Mk...",
 * };
 * ```
 */
export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
  /**
   * Wallet-side descriptor of the key behind the method (derivation
   * coordinates, key type, …), as recorded by the bridge that projected it.
   */
  metadata?: Record<string, unknown>;
}

/**
 * A DID Document service entry, per the
 * {@link https://www.w3.org/TR/did-core/#services W3C DID Core} data model:
 * an `id`, a `type` and a `serviceEndpoint`, plus any service-specific
 * properties a bridge chooses to record.
 *
 * @example
 * ```typescript
 * const service: Service = {
 *   id: `${did}#messaging`,
 *   type: "DIDCommMessaging",
 *   serviceEndpoint: "https://hub.example/inbox",
 * };
 * ```
 */
export interface Service {
  /** The service id, conventionally a fragment of the DID (`did:key:z…#name`). */
  id: string;
  /** The service type (e.g. `"DIDCommMessaging"`, `"LinkedDomains"`). */
  type: string;
  /** One or more URIs, or a map of service-specific endpoint properties. */
  serviceEndpoint: string | string[] | Record<string, unknown>;
  /**
   * Any other service-specific properties
   */
  [key: string]: unknown;
}

/**
 * The minimal identity contract every store entry satisfies.
 *
 * Structural twin of the accounts store's `BaseAccount`: consumers subclass
 * it into N concrete identity types (local keystore-backed, remote
 * wallet-synced, …) and narrow them back via `type` or a `metadata`
 * discriminant.
 *
 * @example
 * ```typescript
 * interface RemoteIdentity extends BaseIdentity {
 *   metadata: { source: "connection"; sessionId: string };
 * }
 * ```
 */
export interface BaseIdentity {
  /**
   * The public address of the identity (e.g. DID:key).
   */
  address: string;

  /**
   * Type of identity
   */
  type: IdentityType;

  /**
   * Subclass via the metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Represents an identity that can sign transactions.
 *
 * Superset of {@link BaseIdentity}: rich fields are optional extras so the
 * type stays assignable wherever a {@link BaseIdentity} is expected.
 *
 * @example
 * ```typescript
 * const identity: Identity = { address: did, did, type: "did:key", didDocument };
 * ```
 */
export interface Identity extends BaseIdentity {
  /**
   * The DID:key format if available.
   */
  did?: string;

  /**
   * The W3C DID Document.
   */
  didDocument?: DIDDocument;

  /**
   * A method to sign a transaction or a set of transactions.
   *
   * @param txns - The transactions to sign.
   * @returns The signed transactions.
   */
  sign?: (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}

/**
 * The JSON-safe twin of an {@link Identity}: every public field, no
 * `sign`. This is the shape identity records travel the wire in (see
 * `@algorandfoundation/identities-connections-extension`), and the
 * shape consumers hold when they read a peer's records off a session.
 *
 * @example
 * ```typescript
 * const { sign, ...record } = identity;
 * const wire: IdentityRecord = record;
 * ```
 */
export type IdentityRecord = Omit<Identity, "sign">;

/**
 * The state of the identity store.
 *
 * @template T - The identity type held by the store.
 *
 * @example
 * ```typescript
 * const store = new Store<IdentityStoreState>({ identities: [] });
 * ```
 */
export interface IdentityStoreState<T extends BaseIdentity = Identity> {
  /**
   * The list of identities in the store.
   */
  identities: T[];
}

/**
 * The surface {@link WithIdentities} mounts on a Provider: the reactive
 * `identities` list plus the `identity.store` API.
 *
 * @template T - The identity type held by the store.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithIdentities]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, {});
 * await provider.identity.store.addIdentity({ address: did, type: "did:key" });
 * console.log(provider.identities.length); // 1
 * ```
 */
export interface IdentityStoreExtension<
  T extends BaseIdentity = Identity,
> extends IdentityStoreState<T> {
  /**
   * An object that represents additional functionality provided by this extension.
   */
  identity: {
    store: IdentityStoreApi<T>;
  };
}

/**
 * The identity store API mounted at `provider.identity.store`. Every method
 * is routed through the `hooks` collection under its operation id.
 *
 * @template T - The identity type held by the store.
 *
 * @example
 * ```typescript
 * provider.identity.store.hooks.before("add", ({ identity }) => {
 *   console.log("adding", identity.address);
 * });
 * await provider.identity.store.addIdentity({ address: did, type: "did:key" });
 * ```
 */
export interface IdentityStoreApi<T extends BaseIdentity = Identity> {
  /**
   * Adds an identity to the store.
   *
   * @param identity - The identity to add.
   * @returns The added identity.
   */
  addIdentity: (identity: T) => Promise<T>;
  /**
   * Removes an identity from the store by its address.
   *
   * @param address - The address of the identity to remove.
   * @returns A promise that resolves when the identity is removed.
   */
  removeIdentity: (address: string) => Promise<void>;
  /**
   * Retrieves an identity from the store by its address.
   *
   * @param address - The address of the identity to retrieve.
   * @returns The identity if found, otherwise undefined.
   */
  getIdentity: (address: string) => Promise<T | undefined>;
  /**
   * Clears all identities from the store.
   *
   * @returns A promise that resolves when the store is cleared.
   */
  clear: () => Promise<void>;
  /**
   * Updates the DID Document of an existing identity.
   *
   * @param address - The address of the identity to update.
   * @param didDocument - The new DID Document to set.
   * @returns The updated identity if found, otherwise undefined.
   */
  updateDidDocument: (address: string, didDocument: DIDDocument) => Promise<T | undefined>;
  /**
   * Shallow-merges `metadata` into an existing identity's `metadata`.
   *
   * @param address - The address of the identity to update.
   * @param metadata - The metadata fields to merge in (existing keys are overwritten).
   * @returns The updated identity if found, otherwise undefined.
   */
  updateIdentityMetadata: (
    address: string,
    metadata: Record<string, unknown>,
  ) => Promise<T | undefined>;
  /**
   * The hooks for identity store operations. Operation ids: `"add"`,
   * `"remove"`, `"get"`, `"clear"`, `"updateDidDocument"`, `"updateMetadata"`.
   */
  hooks: HookCollection<any>;
}
