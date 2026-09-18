import type {
  Account,
  AccountStoreOptions,
  AccountStoreState,
} from "@algorandfoundation/accounts-core";
import type { KeyStoreNamespace, KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

/**
 * The `options.accounts.keystore` block this bridge adds to the shared
 * `options.accounts` namespace (see
 * {@link import("@algorandfoundation/accounts-core").AccountsNamespace}).
 *
 * @example
 * ```typescript
 * const provider = new MyProvider(
 *   { id: "my-provider", name: "My Provider" },
 *   {
 *     accounts: { store: accountStore, keystore: { autoPopulate: false } },
 *     keystore: { store: keyStore, hooks: keyStoreHooks },
 *   },
 * );
 * ```
 */
export interface AccountsKeystoreNamespace {
  /**
   * Whether to automatically add accounts for all compatible keys in the keystore.
   * Defaults to true.
   */
  autoPopulate?: boolean;
}

declare module "@algorandfoundation/accounts-core" {
  /**
   * Keystore-bridge additions to the shared `options.accounts` namespace.
   */
  interface AccountsNamespace {
    /** Keystore-bridge settings, see {@link AccountsKeystoreNamespace}. */
    keystore?: AccountsKeystoreNamespace;
  }
}

/**
 * Represents an account that is backed by the keystore for signing.
 *
 * @example
 * ```typescript
 * const account = provider.accounts.find(isKeystoreAccount);
 * if (account) {
 *   const [signed] = await account.sign([txnBytes]);
 * }
 * ```
 */
export interface KeystoreAccount extends Account {
  type: "keystore-account";
  /**
   * Account metadata. Includes the originating key id (and its type), an
   * optional parent key id, and (when resolvable) the scheme of the parent
   * seed (e.g. `"bip39"`, `"algo25"`) that this account's key chain was
   * imported under.
   */
  metadata?: {
    keyId: string;
    /**
     * The backing key's type (e.g. `"hd-derived-ed25519"`, `"ed25519"`,
     * `"falcon-1024"`); lets consumers label the account kind (HD vs
     * standalone ed25519 vs post-quantum Falcon).
     */
    keyType?: string;
    parentKeyId?: string;
    /**
     * The `metadata.scheme` value of the seed that ultimately produced this
     * account's signing key. Only present when the seed is reachable in the
     * keystore and exposes a `scheme` in its metadata.
     */
    seedScheme?: string;
    [key: string]: unknown;
  };
  /**
   * A method to sign a transaction or a set of transactions.
   *
   * @param txns - The transactions to sign.
   * @returns The signed transactions.
   */
  sign: (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}

/**
 * Options for the AccountsKeystore extension.
 *
 * Narrows the shared registry: `options.accounts.store` and
 * `options.keystore` are **required** when the bridge is mounted (it reads
 * the keystore's reactive store and writes into the accounts store), while
 * `options.accounts.keystore` (see {@link AccountsKeystoreNamespace}) stays
 * optional.
 *
 * @example
 * ```typescript
 * const options: AccountsKeystoreExtensionOptions = {
 *   accounts: { store: accountStore, keystore: { autoPopulate: true } },
 *   keystore: { store: keyStore, hooks: keyStoreHooks },
 * };
 * ```
 */
export interface AccountsKeystoreExtensionOptions
  extends AccountStoreOptions<KeystoreAccount>, KeyStoreOptions {
  /** Accounts-specific settings; the shared store is required. */
  accounts: NonNullable<AccountStoreOptions<KeystoreAccount>["accounts"]> & {
    /**
     * The TanStack store instance backing the account state.
     * Required; the extension populates it from the keystore.
     */
    store: Store<AccountStoreState<KeystoreAccount>>;
    /** Keystore-bridge settings, see {@link AccountsKeystoreNamespace}. */
    keystore?: AccountsKeystoreNamespace;
  };
  /** Keystore-specific settings; the keystore's reactive store is required. */
  keystore: KeyStoreNamespace;
}
