import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import {
  DEFAULT_STATE,
  setAccounts,
  WalletManager,
  type State,
  type WalletAccount,
} from "@txnlab/use-wallet";
import { describe, expect, it } from "vitest";
import { WithAccounts } from "./extension.ts";
import { addAccount, clearAccounts, getAccount, removeAccount, setActiveAccount } from "./store.ts";
import type { Account, AccountStoreState } from "./types.ts";

const WALLET_KEY = "test-wallet";

function emptyState(): AccountStoreState<Account> {
  return { wallets: {}, activeWallet: null };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Account 1",
    address: "A".repeat(58),
    type: "ed25519",
    balance: BigInt(0),
    assets: [],
    ...overrides,
  };
}

describe("Account Store Extension", () => {
  it("should align with README usage", async () => {
    const MyProvider = Provider.withExtensions([WithAccounts]);

    const accountStore = new Store<AccountStoreState<Account>>({
      wallets: {},
      activeWallet: null,
    });

    const provider = new MyProvider(
      { id: "my-provider", name: "My Provider" },
      {
        accounts: {
          store: accountStore,
        },
      },
    ) as any;

    // Access account store methods
    const mockAddress = "A".repeat(58);
    await provider.account.store.addAccount({
      name: "Account 1",
      address: mockAddress,
      type: "ed25519",
      balance: BigInt(0),
      assets: [],
    });
    expect(provider.accounts).toHaveLength(1);
    expect(provider.accounts[0].address).toEqual(mockAddress);

    // Accounts land under the provider's wallet key, use-wallet style
    expect(accountStore.state.wallets["my-provider"]?.accounts).toHaveLength(1);
    expect(accountStore.state.activeWallet).toEqual("my-provider");

    await provider.account.store.clear();
    expect(provider.accounts).toHaveLength(0);
  });

  it("should scope accounts to a custom wallet key", async () => {
    const MyProvider = Provider.withExtensions([WithAccounts]);
    const store = new Store<AccountStoreState<Account>>(emptyState());

    const provider = new MyProvider(
      { id: "my-provider", name: "My Provider" },
      { accounts: { store, walletKey: "custom-key" } },
    ) as any;

    await provider.account.store.addAccount(makeAccount());
    expect(store.state.wallets["custom-key"]?.accounts).toHaveLength(1);
    expect(store.state.wallets["my-provider"]).toBeUndefined();
    expect(provider.accounts).toHaveLength(1);
  });

  describe("store functions", () => {
    it("should add an account under the wallet key", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account = makeAccount();

      addAccount({ store, walletKey: WALLET_KEY, account });

      const wallet = store.state.wallets[WALLET_KEY];
      expect(wallet?.accounts).toContainEqual(account);
      expect(wallet?.activeAccount).toEqual(account);
      expect(store.state.activeWallet).toEqual(WALLET_KEY);
    });

    it("should not claim activeWallet when already set", () => {
      const store = new Store<AccountStoreState<Account>>({
        wallets: {},
        activeWallet: "other-wallet",
      });

      addAccount({ store, walletKey: WALLET_KEY, account: makeAccount() });

      expect(store.state.activeWallet).toEqual("other-wallet");
    });

    it("should keep the current active account when adding another", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account1 = makeAccount();
      const account2 = makeAccount({ name: "Account 2", address: "B".repeat(58) });

      addAccount({ store, walletKey: WALLET_KEY, account: account1 });
      addAccount({ store, walletKey: WALLET_KEY, account: account2 });

      const wallet = store.state.wallets[WALLET_KEY];
      expect(wallet?.accounts).toHaveLength(2);
      expect(wallet?.activeAccount).toEqual(account1);
    });

    it("should not duplicate accounts with the same address", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account = makeAccount();
      const updated = makeAccount({ name: "Renamed", balance: BigInt(100) });

      addAccount({ store, walletKey: WALLET_KEY, account });
      addAccount({ store, walletKey: WALLET_KEY, account: updated });

      const wallet = store.state.wallets[WALLET_KEY];
      expect(wallet?.accounts).toHaveLength(1);
      expect(wallet?.accounts[0]).toEqual(updated);
    });

    it("should remove an account", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account = makeAccount();

      addAccount({ store, walletKey: WALLET_KEY, account });
      removeAccount({ store, walletKey: WALLET_KEY, address: account.address });

      // Removing the last account deletes the wallet entry and
      // releases the activeWallet slot
      expect(store.state.wallets[WALLET_KEY]).toBeUndefined();
      expect(store.state.activeWallet).toBeNull();
    });

    it("should promote the next account when removing the active one", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account1 = makeAccount();
      const account2 = makeAccount({ name: "Account 2", address: "B".repeat(58) });

      addAccount({ store, walletKey: WALLET_KEY, account: account1 });
      addAccount({ store, walletKey: WALLET_KEY, account: account2 });
      removeAccount({ store, walletKey: WALLET_KEY, address: account1.address });

      const wallet = store.state.wallets[WALLET_KEY];
      expect(wallet?.accounts).toEqual([account2]);
      expect(wallet?.activeAccount).toEqual(account2);
    });

    it("should get an account", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account = makeAccount();

      addAccount({ store, walletKey: WALLET_KEY, account });

      const found = getAccount({ store, walletKey: WALLET_KEY, address: account.address });
      expect(found).toEqual(account);
    });

    it("should return undefined for non-existent account", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const found = getAccount({ store, walletKey: WALLET_KEY, address: "non-existent" });
      expect(found).toBeUndefined();
    });

    it("should set the active account", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account1 = makeAccount();
      const account2 = makeAccount({ name: "Account 2", address: "B".repeat(58) });

      addAccount({ store, walletKey: WALLET_KEY, account: account1 });
      addAccount({ store, walletKey: WALLET_KEY, account: account2 });
      setActiveAccount({ store, walletKey: WALLET_KEY, address: account2.address });

      expect(store.state.wallets[WALLET_KEY]?.activeAccount).toEqual(account2);
    });

    it("should ignore setActiveAccount for unknown addresses", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account = makeAccount();

      addAccount({ store, walletKey: WALLET_KEY, account });
      setActiveAccount({ store, walletKey: WALLET_KEY, address: "unknown" });

      expect(store.state.wallets[WALLET_KEY]?.activeAccount).toEqual(account);
    });

    it("should clear accounts", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());

      addAccount({ store, walletKey: WALLET_KEY, account: makeAccount() });
      clearAccounts({ store, walletKey: WALLET_KEY });

      expect(store.state.wallets[WALLET_KEY]).toBeUndefined();
      expect(store.state.activeWallet).toBeNull();
    });

    it("should isolate wallet keys from each other", () => {
      const store = new Store<AccountStoreState<Account>>(emptyState());
      const account1 = makeAccount();
      const account2 = makeAccount({ name: "Account 2", address: "B".repeat(58) });

      addAccount({ store, walletKey: "wallet-a", account: account1 });
      addAccount({ store, walletKey: "wallet-b", account: account2 });

      expect(store.state.wallets["wallet-a"]?.accounts).toEqual([account1]);
      expect(store.state.wallets["wallet-b"]?.accounts).toEqual([account2]);
      expect(store.state.activeWallet).toEqual("wallet-a");

      // clear only touches its own wallet key
      clearAccounts({ store, walletKey: "wallet-a" });
      expect(store.state.wallets["wallet-a"]).toBeUndefined();
      expect(store.state.wallets["wallet-b"]?.accounts).toEqual([account2]);
      expect(store.state.activeWallet).toBeNull();

      // removing from one key never touches the other
      removeAccount({ store, walletKey: "wallet-b", address: account2.address });
      expect(store.state.wallets["wallet-b"]).toBeUndefined();
    });

    it("should preserve extra state fields (use-wallet shape)", () => {
      const store = new Store<State<Account>>({ ...DEFAULT_STATE } as State<Account>);
      const account = makeAccount();

      addAccount({ store, walletKey: WALLET_KEY, account });
      setActiveAccount({ store, walletKey: WALLET_KEY, address: account.address });
      removeAccount({ store, walletKey: WALLET_KEY, address: account.address });
      clearAccounts({ store, walletKey: WALLET_KEY });

      expect(store.state.activeNetwork).toEqual(DEFAULT_STATE.activeNetwork);
      expect(store.state.algodClient).toBe(DEFAULT_STATE.algodClient);
      expect(store.state.networkConfig).toEqual(DEFAULT_STATE.networkConfig);
      expect(store.state.managerStatus).toEqual(DEFAULT_STATE.managerStatus);
    });
  });

  describe("interchangeability with use-wallet", () => {
    it("shares one store instance between WithAccounts and WalletManager", async () => {
      // One store, shaped like use-wallet's State
      const store = new Store<State<Account>>({ ...DEFAULT_STATE } as State<Account>);

      // Mount the wallet-provider extension on the shared store
      const MyProvider = Provider.withExtensions([WithAccounts]);
      const provider = new MyProvider(
        { id: "provider-id", name: "My Provider" },
        { accounts: { store } },
      ) as any;

      // Extension writes are visible before the manager exists
      const extensionAccount = makeAccount({ name: "Extension Account" });
      await provider.account.store.addAccount(extensionAccount);

      // The same instance backs use-wallet's WalletManager. Order doesn't
      // matter: the manager spreads its initial state over the store and
      // only ever cleans up wallet keys it hydrated itself
      const manager = new WalletManager({ options: { store } });
      expect(manager.store).toBe(store);

      // Extension-written accounts are visible through the manager,
      // exactly as use-wallet's own addWallet/setAccounts would write them
      expect(manager.store.state.wallets["provider-id"]?.accounts).toEqual([extensionAccount]);
      expect(manager.store.state.wallets["provider-id"]?.activeAccount).toEqual(extensionAccount);
      expect(manager.store.state.activeWallet).toEqual("provider-id");

      // A use-wallet mutation is visible through the provider extension
      const walletAccount: WalletAccount = {
        name: "Wallet Account",
        address: "B".repeat(58),
      };
      setAccounts(store, { walletId: "provider-id", accounts: [walletAccount] });
      expect(provider.accounts).toEqual([walletAccount]);

      // And the provider's read API sees it too
      const found = await provider.account.store.getAccount(walletAccount.address);
      expect(found).toEqual(walletAccount);
    });
  });
});
