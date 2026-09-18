import type { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import { addAccount, clearAccounts, getAccount, removeAccount, setActiveAccount } from "./store.ts";
import type {
  AccountStoreExtension,
  AccountStoreOptions,
  AccountStoreState,
  BaseAccount,
} from "./types.ts";

/**
 * Extension that adds account management capabilities to a Provider.
 *
 * Accounts are read and written under a wallet key (defaults to the
 * provider's `id`) in a state shape shared with use-wallet: the same
 * TanStack store instance can be passed to both this extension
 * (`options.accounts.store`) and use-wallet's `WalletManager({ options: { store } })`.
 *
 * The session-scoped remote mirror lives in
 * `@algorandfoundation/accounts-connections-extension` (`WithAccountsConnections`),
 * which mounts it at `provider.account.remote` over the same shared store.
 *
 * @template T - The account type stored under each wallet key.
 * @template S - The full store state shape; may structurally extend
 * {@link AccountStoreState} (e.g. use-wallet's `State<T>`).
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension; see
 *   {@link AccountStoreOptions} (`options.accounts`).
 * @returns The account store extension.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts]);
 * const provider = new MyProvider(
 *   { id: "my-provider", name: "My Provider" },
 *   { accounts: { store, hooks } },
 * );
 *
 * await provider.account.store.addAccount({ name: "Main", address: "ADDRESS..." });
 * console.log(provider.accounts);
 * ```
 */
export const WithAccounts = <
  T extends BaseAccount,
  S extends AccountStoreState<T> = AccountStoreState<T>,
>(
  provider: Provider<any> & AccountStoreExtension<T>,
  options?: AccountStoreOptions<T, S>,
): AccountStoreExtension<T> => {
  const store: Store<S> =
    options?.accounts?.store ??
    (new Store<AccountStoreState<T>>({ wallets: {}, activeWallet: null }) as Store<S>);
  const hooks = options?.accounts?.hooks ?? new Hook.Collection<any>();
  const walletKey = options?.accounts?.walletKey ?? provider.id;

  return {
    get accounts() {
      return store.state.wallets[walletKey]?.accounts ?? [];
    },
    account: {
      store: provider.account?.store || {
        async addAccount(account: T): Promise<T> {
          return hooks("add", addAccount<T, S>, { store, walletKey, account });
        },
        async removeAccount(address: string): Promise<void> {
          return hooks("remove", removeAccount<T, S>, { store, walletKey, address });
        },
        async getAccount(address: string): Promise<T | undefined> {
          return hooks("get", getAccount<T, S>, { store, walletKey, address });
        },
        async setActiveAccount(address: string): Promise<void> {
          return hooks("set-active", setActiveAccount<T, S>, { store, walletKey, address });
        },
        async clear(): Promise<void> {
          return hooks("clear", clearAccounts<T, S>, { store, walletKey });
        },
        hooks,
      },
    },
  } as AccountStoreExtension<T>;
};
