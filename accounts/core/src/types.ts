import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Unique key for a wallet entry in the store.
 *
 * Structural twin of use-wallet's `WalletKey`.
 *
 * @example
 * ```typescript
 * const walletKey: WalletKey = provider.id;
 * const accounts = store.state.wallets[walletKey]?.accounts ?? [];
 * ```
 */
export type WalletKey = string;

/**
 * The minimal account contract shared with use-wallet.
 *
 * Structural twin of use-wallet's `WalletAccount`: the two libraries are
 * mutually assignable in the generic seat without any dependency between them.
 *
 * @example
 * ```typescript
 * const account: BaseAccount = { name: "Main", address: "ADDRESS..." };
 * ```
 */
export interface BaseAccount {
  /**
   * Human-readable display name of the account.
   */
  name: string;

  /**
   * The public address of the account.
   */
  address: string;

  /**
   * Subclass via the metadata
   */
  metadata?: Record<string, any>;
}

/**
 * The kind of an {@link Account}. Well-known values are listed; bridges may
 * introduce their own discriminators (e.g. `"algorand-account"`).
 *
 * @example
 * ```typescript
 * const type: AccountType = "ed25519";
 * ```
 */
export type AccountType = "ed25519" | "lsig" | "falcon" | string;

/**
 * An asset held by an {@link Account} (e.g. an Algorand Standard Asset).
 *
 * Structural twin of use-wallet's asset record: `metadata` stays a loose
 * `Record<string, any>` so the two stay mutually assignable.
 *
 * @example
 * ```typescript
 * const asset: AccountAsset = {
 *   id: "31566704",
 *   name: "USDC",
 *   type: "asa",
 *   balance: 1_000_000n,
 *   metadata: { decimals: 6 },
 * };
 * ```
 */
export interface AccountAsset {
  /** The asset identifier (e.g. the ASA id as a string). */
  id: string;
  /** Human-readable asset name. */
  name: string;
  /** The asset kind (e.g. `"asa"`). */
  type: string;
  /** The balance held, in the asset's base units. */
  balance: bigint;
  /** Arbitrary asset metadata (e.g. the on-chain asset params). */
  metadata: Record<string, any>;
}

/**
 * Represents an account that can sign transactions.
 *
 * Superset of {@link BaseAccount}: rich fields are optional extras so the
 * type stays mutually assignable with use-wallet's `WalletAccount`.
 *
 * @example
 * ```typescript
 * const account: Account = {
 *   name: "Main",
 *   address: "ADDRESS...",
 *   type: "ed25519",
 *   balance: 0n,
 *   assets: [],
 * };
 * ```
 */
export interface Account extends BaseAccount {
  /**
   * The balance of the account in microalgos.
   */
  balance?: bigint;

  /**
   * The assets held by the account.
   */
  assets?: AccountAsset[];

  /**
   * Type of account
   */
  type?: AccountType;
}

/**
 * Per-wallet account state.
 *
 * Structural twin of use-wallet's `WalletState<T>`.
 *
 * @example
 * ```typescript
 * const wallet: WalletState<Account> = { accounts: [], activeAccount: null };
 * ```
 */
export interface WalletState<T = Account> {
  /**
   * The list of accounts under this wallet key.
   */
  accounts: T[];

  /**
   * The currently active account for this wallet key.
   */
  activeAccount: T | null;
}

/**
 * The state of the account store.
 *
 * Structural subset of use-wallet's `State<T>`: a use-wallet
 * `Store<State<T>>` instance is accepted anywhere a
 * `Store<S extends AccountStoreState<T>>` is expected.
 *
 * @example
 * ```typescript
 * const store = new Store<AccountStoreState<Account>>({ wallets: {}, activeWallet: null });
 * ```
 */
export interface AccountStoreState<T = Account> {
  /**
   * Accounts partitioned by wallet key.
   */
  wallets: Partial<Record<WalletKey, WalletState<T>>>;

  /**
   * The currently active wallet key.
   */
  activeWallet: WalletKey | null;
}

/**
 * The `options.accounts` namespace {@link WithAccounts} claims on the shared
 * {@link ExtensionOptions} registry.
 *
 * This is the non-generic half of the two-level registry: bridges layering
 * on top of the store (`@algorandfoundation/accounts-keystore-extension`,
 * `@algorandfoundation/accounts-connections-extension`) **augment** this
 * interface with their own fields (`keystore`, `remote`), so a composition
 * root keeps a single typed `options.accounts` block. The generic
 * {@link AccountStoreOptions} narrows the same block to a concrete account
 * and state type.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/accounts-core" {
 *   interface AccountsNamespace {
 *     keystore?: { autoPopulate?: boolean };
 *   }
 * }
 * ```
 */
export interface AccountsNamespace {
  /**
   * The TanStack store instance backing the account state. Pass the same
   * instance to use-wallet's `WalletManager({ options: { store } })` to
   * share state. A new empty store is created when omitted.
   */
  store?: Store<AccountStoreState>;

  /**
   * Hooks for intercepting account store operations.
   */
  hooks?: HookCollection<any>;

  /**
   * The wallet key the extension reads and writes under.
   * Defaults to the provider's `id`.
   */
  walletKey?: WalletKey;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Accounts-specific settings, see {@link AccountsNamespace}. */
    accounts?: AccountsNamespace;
  }
}

/**
 * Options for the AccountStore extension.
 *
 * Generic narrowing of the registered {@link AccountsNamespace}: the
 * `accounts` block is typed against the concrete account type `T` and
 * store state `S` (which is why it replaces, rather than extends, the
 * non-generic registry entry), while every other registered namespace is
 * inherited from {@link ExtensionOptions} untouched.
 *
 * @template T - The account type stored under each wallet key.
 * @template S - The full store state shape; may structurally extend
 * {@link AccountStoreState} (e.g. use-wallet's `State<T>`).
 *
 * @example
 * ```typescript
 * const options: AccountStoreOptions<Account> = {
 *   accounts: { store, hooks, walletKey: "my-wallet" },
 * };
 * ```
 */
export interface AccountStoreOptions<
  T = Account,
  S extends AccountStoreState<T> = AccountStoreState<T>,
> extends Omit<ExtensionOptions, "accounts"> {
  /** Accounts-specific settings, typed against `T` and `S`. */
  accounts?: {
    /**
     * The TanStack store instance backing the account state. Pass the same
     * instance to use-wallet's `WalletManager({ options: { store } })` to
     * share state.
     */
    store?: Store<S>;

    /**
     * Hooks for intercepting account store operations.
     */
    hooks?: HookCollection<any>;

    /**
     * The wallet key the extension reads and writes under.
     * Defaults to the provider's `id`.
     */
    walletKey?: WalletKey;
  };
}

/**
 * Represents an account store interface for managing accounts.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts]);
 * const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});
 * await provider.account.store.addAccount({ name: "Main", address: "ADDRESS..." });
 * console.log(provider.accounts);
 * ```
 */
export interface AccountStoreExtension<T> {
  /**
   * The list of accounts under the extension's wallet key.
   */
  accounts: T[];

  /**
   * An object that represents additional functionality provided by this extension.
   */
  account: {
    store: AccountStoreApi<T>;
  };
}

/**
 * Interface representing an AccountStore extension API.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * provider.account.store.hooks.before("add", ({ account }) => {
 *   console.log("Adding", account.address);
 * });
 * await provider.account.store.addAccount({ name: "Main", address: "ADDRESS..." });
 * await provider.account.store.setActiveAccount("ADDRESS...");
 * ```
 */
export interface AccountStoreApi<T> {
  /**
   * Adds an account to the store.
   *
   * @param account - The account to add.
   * @returns The added account.
   */
  addAccount: (account: T) => Promise<T>;
  /**
   * Removes an account from the store by its address.
   *
   * @param address - The address of the account to remove.
   * @returns A promise that resolves when the account is removed.
   */
  removeAccount: (address: string) => Promise<void>;
  /**
   * Retrieves an account from the store by its address.
   *
   * @param address - The address of the account to retrieve.
   * @returns The account if found, otherwise undefined.
   */
  getAccount: (address: string) => Promise<T | undefined>;
  /**
   * Sets the active account by its address.
   *
   * @param address - The address of the account to activate.
   * @returns A promise that resolves when the active account is set.
   */
  setActiveAccount: (address: string) => Promise<void>;
  /**
   * Clears all accounts from the store.
   *
   * @returns A promise that resolves when the store is cleared.
   */
  clear: () => Promise<void>;
  /**
   * The hooks for account store operations.
   */
  hooks: HookCollection<any>;
}
