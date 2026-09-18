import type { Store } from "@tanstack/store";
import type { AccountStoreState, BaseAccount, WalletKey, WalletState } from "./types.ts";

/**
 * Adds an account to the store under the given wallet key.
 *
 * Creates the wallet entry if it does not exist, replaces any existing
 * account with the same address, keeps the current active account (or
 * activates the added account when none is active), and claims the
 * `activeWallet` slot only when it is unset.
 *
 * @param params - The add parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.walletKey - The wallet key to add the account under.
 * @param params.account - The {@link Account} to add.
 * @returns The added {@link Account}.
 */
export function addAccount<T extends BaseAccount, S extends AccountStoreState<T>>({
  store,
  walletKey,
  account,
}: {
  store: Store<S>;
  walletKey: WalletKey;
  account: T;
}): T {
  store.setState((state: S): S => {
    const wallet: WalletState<T> = state.wallets[walletKey] ?? {
      accounts: [],
      activeAccount: null,
    };
    const accounts = [
      { ...account },
      ...wallet.accounts.filter((a) => a.address !== account.address),
    ];
    const activeAccount =
      wallet.activeAccount && wallet.activeAccount.address !== account.address
        ? wallet.activeAccount
        : { ...account };
    return {
      ...state,
      wallets: {
        ...state.wallets,
        [walletKey]: { accounts, activeAccount },
      },
      activeWallet: state.activeWallet ?? walletKey,
    } as S;
  });
  return account;
}

/**
 * Removes an account from the store by its address.
 *
 * Promotes the next account when the active account is removed. Removing
 * the last account deletes the wallet entry and releases the
 * `activeWallet` slot if it pointed at this wallet key.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.walletKey - The wallet key the account lives under.
 * @param params.address - The address of the account to remove.
 */
export function removeAccount<T extends BaseAccount, S extends AccountStoreState<T>>({
  store,
  walletKey,
  address,
}: {
  store: Store<S>;
  walletKey: WalletKey;
  address: string;
}): void {
  store.setState((state: S): S => {
    const wallet = state.wallets[walletKey];
    if (!wallet) {
      return state;
    }
    const accounts = wallet.accounts.filter((account) => account.address !== address);
    if (accounts.length === 0) {
      const updatedWallets = { ...state.wallets };
      delete updatedWallets[walletKey];
      return {
        ...state,
        wallets: updatedWallets,
        activeWallet: state.activeWallet === walletKey ? null : state.activeWallet,
      } as S;
    }
    const activeAccount =
      wallet.activeAccount?.address === address ? accounts[0] : wallet.activeAccount;
    return {
      ...state,
      wallets: {
        ...state.wallets,
        [walletKey]: { accounts, activeAccount },
      },
    } as S;
  });
}

/**
 * Retrieves an account from the store by its address.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.walletKey - The wallet key the account lives under.
 * @param params.address - The address of the account to retrieve.
 * @returns The {@link Account} if found, otherwise undefined.
 */
export function getAccount<T extends BaseAccount, S extends AccountStoreState<T>>({
  store,
  walletKey,
  address,
}: {
  store: Store<S>;
  walletKey: WalletKey;
  address: string;
}): T | undefined {
  return store.state.wallets[walletKey]?.accounts.find((account) => account.address === address);
}

/**
 * Sets the active account for the given wallet key by its address.
 *
 * Mirrors use-wallet's `setActiveAccount` semantics: a no-op when the
 * wallet entry or the account is not found.
 *
 * @param params - The activation parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.walletKey - The wallet key the account lives under.
 * @param params.address - The address of the account to activate.
 */
export function setActiveAccount<T extends BaseAccount, S extends AccountStoreState<T>>({
  store,
  walletKey,
  address,
}: {
  store: Store<S>;
  walletKey: WalletKey;
  address: string;
}): void {
  store.setState((state: S): S => {
    const wallet = state.wallets[walletKey];
    if (!wallet) {
      return state;
    }
    const newActiveAccount = wallet.accounts.find((account) => account.address === address);
    if (!newActiveAccount) {
      return state;
    }
    return {
      ...state,
      wallets: {
        ...state.wallets,
        [walletKey]: {
          accounts: wallet.accounts.map((account) => ({ ...account })),
          activeAccount: { ...newActiveAccount },
        },
      },
    } as S;
  });
}

/**
 * Clears all accounts under the given wallet key.
 *
 * Only the extension's own wallet entry is removed; accounts under other
 * wallet keys are never touched. Releases the `activeWallet` slot if it
 * pointed at this wallet key.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.walletKey - The wallet key to clear.
 */
export function clearAccounts<T extends BaseAccount, S extends AccountStoreState<T>>({
  store,
  walletKey,
}: {
  store: Store<S>;
  walletKey: WalletKey;
}): void {
  store.setState((state: S): S => {
    const updatedWallets = { ...state.wallets };
    delete updatedWallets[walletKey];
    return {
      ...state,
      wallets: updatedWallets,
      activeWallet: state.activeWallet === walletKey ? null : state.activeWallet,
    } as S;
  });
}
