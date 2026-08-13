import type { Account, AccountStoreOptions } from "@algorandfoundation/accounts-store";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { KeyStoreOptions } from "@algorandfoundation/keystore-core";

/**
 * Represents an account that is backed by the keystore for signing.
 */
export interface KeystoreAccount extends Account {
  type: "keystore-account";
  /**
   * Account metadata. Includes the originating key id, optional parent key id,
   * and — when resolvable — the scheme of the parent seed (e.g. `"bip39"`,
   * `"algo25"`) that this account's key chain was imported under.
   */
  metadata?: {
    keyId: string;
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
 */
export interface AccountsKeystoreExtensionOptions
  extends ExtensionOptions, AccountStoreOptions<KeystoreAccount>, KeyStoreOptions {
  accounts: AccountStoreOptions<KeystoreAccount>["accounts"] & {
    keystore: {
      /**
       * Whether to automatically add accounts for all compatible keys in the keystore.
       * Defaults to true.
       */
      autoPopulate?: boolean;
    };
  };
}
