import { type Provider } from "@algorandfoundation/wallet-provider";
import {
  Account,
  AccountStoreExtension,
  addAccount,
  AccountStoreOptions,
  removeAccount,
} from "@algorandfoundation/accounts";

/**
 * Represents a watched account that only has a public address.
 */
export interface WatchedAccount extends Account {
  /**
   * The type of the account.
   */
  type: "watched";
  /**
   * A friendly name for the watched account.
   */
  name: string;
}

/**
 * Type guard to narrow an account to a WatchedAccount.
 *
 * @param account The account to check.
 * @returns True if the account is a WatchedAccount.
 */
export function isWatchedAccount(account: Account): account is WatchedAccount {
  return account.type === "watched";
}

/**
 * API for managing watched accounts.
 */
export interface WatchedAccountApi {
  /**
   * Adds a watched account.
   * @param account The account to watch.
   */
  addWatchedAccount(account: Omit<WatchedAccount, "type">): Promise<WatchedAccount>;
  /**
   * Removes a watched account by address.
   * @param address The address of the account to remove.
   */
  removeWatchedAccount(address: string): Promise<void>;
}

/**
 * Extension that adds watched account management.
 */
export interface WatchedAccountExtension {
  /**
   * Reactive array of watched accounts.
   */
  watchedAccounts: WatchedAccount[];
  /**
   * API for managing watched accounts.
   */
  watchedAccount: WatchedAccountApi;
}

/**
 * A hardcoded public key for the example watched account.
 */
export const HARDCODED_WATCHED_ADDRESS =
  "GENESISALGOFNDTIONSWATCHEDACCOUNT1111111111111111111111111";

/**
 * Extension that adds watched account management.
 * Leverages the base account store to manage its accounts.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts, WithWatchedAccount]);
 * const provider = new MyProvider();
 * await provider.watchedAccount.addWatchedAccount({ address: "...", name: "My Account", balance: 0n, assets: [] });
 * ```
 */
export const WithWatchedAccount = (
  provider: Provider<any> & AccountStoreExtension<Account> & WatchedAccountExtension,
  options: AccountStoreOptions<WatchedAccount>,
) => {
  if (!provider.account)
    throw new Error(
      "WithWatchedAccount requires an account store extension to be present on the provider.",
    );
  if (!options?.accounts?.store)
    throw new Error("WithWatchedAccount requires an account store to be present in the options.");

  if (!options?.accounts?.hooks)
    throw new Error("WithWatchedAccount requires hooks to be present in the options.");

  const hooks = options.accounts.hooks;
  const store = options.accounts.store;
  // Accounts live under a wallet key in the (use-wallet-shaped) store;
  // default to the provider's id, the same key WithAccounts scopes to.
  const walletKey = options.accounts.walletKey ?? provider.id;

  return {
    get watchedAccounts() {
      return (provider.accounts || []).filter(isWatchedAccount);
    },
    watchedAccount: {
      addWatchedAccount: async (account: Omit<WatchedAccount, "type">) => {
        const watched: WatchedAccount = { ...account, type: "watched" };
        return hooks("add", addAccount, { store, walletKey, account: watched });
      },
      removeWatchedAccount: async (address: string) => {
        return hooks("remove", removeAccount, { store, walletKey, address });
      },
    },
  };
};
