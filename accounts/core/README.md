# 🏦 @algorandfoundation/accounts-core

Basic reactive state management for accounts.

This package provides a standardized way to manage and interact with account data in a reactive way. It runs fully **standalone** via pure store functions (`addAccount`, `removeAccount`, `getAccount`, `setActiveAccount`, `clearAccounts`) over a plain [@tanstack/store](https://tanstack.com/store) `Store`, no Provider required. It also ships first-class support for the Algorand Wallet Provider via the `WithAccounts` extension. Both usage modes are equal citizens of the API.

## ✨ Features

- **Reactive State**: Built with [@tanstack/store](https://tanstack.com/store) for efficient state management and UI reactivity.
- **Hook-based Extensibility**: Leverages [before-after-hook](https://github.com/gr2m/before-after-hook) to allow for intercepting and extending account operations.
- **Flexible Account Metadata**: Support for custom account types and metadata via generics.
- **Standalone by Design**: The mutations are pure, exported functions over a `Store<AccountStoreState>`, making it usable without any Provider.
- **First-class Provider Support**: The `WithAccounts` extension mounts the same functions on a Wallet Provider.
- **use-wallet Interchangeability**: The state shape is a structural twin of [use-wallet](https://github.com/TxnLab/use-wallet) v5's store; one TanStack store instance can back both a `WalletManager` and a Provider with this extension.

## 🧱 Core Components

- [**`Account`**](./src/types.ts): The account interface, including `name`, `address`, optional `metadata`, plus optional rich fields (`balance`, `assets`, `type`). Structurally assignable to and from use-wallet's `WalletAccount`.
- [**`AccountStoreState`**](./src/types.ts): The nested state shape where accounts are partitioned by wallet key (`wallets[walletKey].accounts`), a structural subset of use-wallet's `State`.
- [**Store functions**](./src/store.ts): `addAccount`, `removeAccount`, `getAccount`, `setActiveAccount`, and `clearAccounts` are pure functions over a `Store<AccountStoreState>` that form the standalone surface of this package.
- [**`WithAccounts`**](./src/extension.ts): The Wallet Provider Extension that adds account management capabilities.
- [**`AccountStoreApi`**](./src/types.ts): The API exposed on a provider to manage accounts (add, remove, get, setActiveAccount, clear).

## 📥 Installation

```bash
pnpm add @algorandfoundation/accounts-core
```

## 🚀 Quick Start

### Standalone: Pure Store Functions

No Provider is needed; create a `Store` and call the exported store functions directly. Every mutation is a pure, shape-preserving function over the state:

```typescript
import { Store } from "@tanstack/store";
import {
  addAccount,
  getAccount,
  removeAccount,
  setActiveAccount,
  type AccountStoreState,
  type Account,
} from "@algorandfoundation/accounts-core";

const store = new Store<AccountStoreState<Account>>({ wallets: {}, activeWallet: null });

// Add an account under a wallet key
addAccount({
  store,
  walletKey: "my-wallet",
  account: { name: "Account 1", address: "ADDRESS...", type: "ed25519" },
});

// Read and activate accounts
const account = getAccount({ store, walletKey: "my-wallet", address: "ADDRESS..." });
setActiveAccount({ store, walletKey: "my-wallet", address: "ADDRESS..." });

// Subscribe to changes
store.subscribe(({ currentVal }) => {
  console.log("Accounts:", currentVal.wallets["my-wallet"]?.accounts);
});

// Remove when done
removeAccount({ store, walletKey: "my-wallet", address: "ADDRESS..." });
```

### With a Provider

The `WithAccounts` extension mounts the same store functions on a Wallet Provider, scoped to a wallet key that defaults to the provider's id.

#### 1. Adding the Extension to a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

// Define a provider with the AccountStore extension
const MyProvider = Provider.withExtensions([WithAccounts]);

// Initialize the provider
const accountStore = new Store({ wallets: {}, activeWallet: null });
const accountHooks = new Hook.Collection();

const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    accounts: {
      store: accountStore,
      hooks: accountHooks,
      // walletKey: "my-provider", // optional (defaults to the provider's id)
    },
  },
);
```

#### 2. Managing Accounts

```typescript
// Add an account (stored under the extension's wallet key)
await provider.account.store.addAccount({
  name: "Account 1",
  address: "ADDRESS...",
  type: "ed25519",
  balance: 0n,
  assets: [],
});

// Access accounts (reactive)
console.log(provider.accounts);

// Subscribe to changes via the store
accountStore.subscribe(({ currentVal }) => {
  console.log("Updated accounts:", currentVal.wallets["my-provider"]?.accounts);
});
```

#### 3. Using Hooks

```typescript
provider.account.store.hooks.before("add", (options) => {
  console.log("Adding account:", options.account.address);
});
```

## ⚙️ Configuration

`WithAccounts` claims the `options.accounts` namespace on the shared `ExtensionOptions` registry (`AccountsNamespace`). Bridges augment the same interface, so a composition root gets one typed `options.accounts` block; the generic `AccountStoreOptions<T, S>` narrows `store` to your account / state types.

| Field                | Type                         | Default                  | Provided by                                          |
| -------------------- | ---------------------------- | ------------------------ | ---------------------------------------------------- |
| `accounts.store`     | `Store<AccountStoreState>`   | new empty store          | `@algorandfoundation/accounts-core`                  |
| `accounts.hooks`     | `HookCollection`             | new collection           | `@algorandfoundation/accounts-core`                  |
| `accounts.walletKey` | `WalletKey`                  | `provider.id`            | `@algorandfoundation/accounts-core`                  |
| `accounts.keystore`  | `{ autoPopulate?: boolean }` | `{ autoPopulate: true }` | `@algorandfoundation/accounts-keystore-extension`    |
| `accounts.remote`    | `{ expose?: (a) => a }`      | identity projection      | `@algorandfoundation/accounts-connections-extension` |

`@algorandfoundation/algorand-accounts-extension` owns the sibling `options.algorand` namespace (`network`, `algodConfig`, `indexerConfig?`, `hooks?`); see its README. When a `WithLogs` extension (`@algorandfoundation/logs`) is mounted, bridges report their sync activity through `provider.log`.

## 🔄 Sharing One Store with use-wallet

The account store's state shape is a **structural twin** of use-wallet v5's core store. There is no dependency between the two libraries; they simply agree on the same shapes:

| accounts-core             | use-wallet          | Shape                                                                        |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `BaseAccount` / `Account` | `WalletAccount`     | `{ name; address; metadata? }` (+ optional `balance`/`assets`/`type` extras) |
| `WalletState<T>`          | `WalletState<T>`    | `{ accounts: T[]; activeAccount: T \| null }`                                |
| `AccountStoreState<T>`    | `State<T>` (subset) | `{ wallets: Partial<Record<WalletKey, WalletState<T>>>; activeWallet }`      |

Because every mutation is generic over the full state type (`S extends AccountStoreState<T>`) and shape-preserving (spreads), a use-wallet `Store<State<T>>` instance is accepted directly; extra fields like `algodClient`, `activeNetwork`, and `networkConfig` are never dropped.

### One store, two systems

```typescript
import { Store } from "@tanstack/store";
import { DEFAULT_STATE, WalletManager, type State } from "@txnlab/use-wallet";
import { WithAccounts, type Account } from "@algorandfoundation/accounts-core";
import { Provider } from "@algorandfoundation/wallet-provider";

// 1. Create ONE store, shaped like use-wallet's State
const store = new Store<State<Account>>({ ...DEFAULT_STATE } as State<Account>);

// 2. Back the Provider extension with it
const MyProvider = Provider.withExtensions([WithAccounts]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  { accounts: { store } },
);

// 3. Back use-wallet with the same instance in either order
const manager = new WalletManager({ options: { store } });

// Extension writes appear under `wallets["my-provider"]` for use-wallet,
// and use-wallet mutations are visible via `provider.accounts`.
```

> **Ordering doesn't matter; one writer per wallet key does.** On construction the `WalletManager` _spreads_ its initial (and persisted) state over the injected store, keeping wallet entries and the `activeWallet` written by other systems; its stale-wallet cleanup only considers keys the manager hydrated itself. Every writer (the manager, adapters, extensions) operates solely on the wallet keys it owns and honors everyone else's. Just don't point two writers at the same key.

### Wallet-key scoping semantics

The extension reads and writes under `options.accounts.walletKey ?? provider.id`, mirroring use-wallet's per-wallet partitioning:

- `addAccount` creates the wallet entry on demand, keeps the current `activeAccount` (activating the added account only when none is active), and claims the global `activeWallet` slot **only when it is unset**, so it never steals it from another wallet.
- `removeAccount` promotes the next account when the active one is removed; removing the last account deletes the wallet entry and releases `activeWallet` if it pointed at this key.
- `clear()` only removes the extension's own wallet entry, leaving other wallets' accounts untouched.
- `setActiveAccount` mirrors use-wallet's semantics (no-op for unknown wallets/addresses).

## 🛠️ Custom Account Types

The Account Store is designed to be generic. You can define your own account types by extending the base `Account` interface.

### 1. Define a Custom Account Type

```typescript
import { Account } from "@algorandfoundation/accounts-core";

export interface MyCustomAccount extends Account {
  type: "custom";
  customField: string;
}

export function isMyCustomAccount(account: Account): account is MyCustomAccount {
  return account.type === "custom";
}
```

### 2. Using with the Extension

You can pass your custom type as a generic to `WithAccounts`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts, type AccountStoreApi } from "@algorandfoundation/accounts-core";

// Use the generic extension with your custom type
const MyProvider = Provider.withExtensions([
  (provider, options) => WithAccounts<MyCustomAccount>(provider, options),
]);

// Or when using the concrete class pattern
class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithAccounts] as const;
  accounts!: MyCustomAccount[];
  account!: { store: AccountStoreApi<MyCustomAccount> };
}
```

### 3. Adding and Accessing Custom Accounts

```typescript
// Add an account with custom fields
await provider.account.store.addAccount({
  name: "Custom Account",
  address: "ADDRESS...",
  type: "custom",
  customField: "some value",
  balance: 0n,
  assets: [],
});

// Get the account back and verify its type
const account = await provider.account.store.getAccount("ADDRESS...");

if (account && isMyCustomAccount(account)) {
  console.log(account.customField);
}
```

## 🔀 Using Union Types

In many cases, a single provider may need to handle multiple different types of accounts. You can achieve this by using a TypeScript union type.

### 1. Define Your Account Union

```typescript
import { Account } from "@algorandfoundation/accounts-core";

export interface IntermezzoAccount extends Account {
  type: "intermezzo";
}

export interface XChainAccount extends Account {
  type: "x-chain";
  metadata: {
    originChain: string;
  };
}

export type MyAccountUnion = IntermezzoAccount | XChainAccount;
```

### 2. Create Type Guard Functions

You can create type narrowing functions for your custom types.

```typescript
export function isIntermezzoAccount(account: Account): account is IntermezzoAccount {
  return account.type === "intermezzo";
}

export function isXChainAccount(account: Account): account is XChainAccount {
  return account.type === "x-chain";
}
```

### 3. Initialize with the Union Type

```typescript
const MyProvider = Provider.withExtensions([
  (provider, options) => WithAccounts<MyAccountUnion>(provider, options),
]);
```

### 4. Type-Safe Access

When retrieving accounts, you can use your type guards to safely access type-specific fields.

```typescript
const account = await provider.account.store.getAccount("ADDRESS...");

if (account && isXChainAccount(account)) {
  // TypeScript now knows this is a XChainAccount
  console.log("Origin Chain:", account.metadata.originChain);
}
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/accounts/core/).

## 📜 License

Apache-2.0
