# 🏦 @algorandfoundation/accounts

Meta package that resolves to the right platform accounts implementation.

One install covers the accounts domain: the `exports` map uses runtime/bundler conditions, exactly like [`@algorandfoundation/keystore`](../../keystore/meta), [`@algorandfoundation/identities`](../../identities/meta), and [`@algorandfoundation/credentials`](../../credentials/meta):

| Condition              | Resolves to                                               |
| ---------------------- | --------------------------------------------------------- |
| `react-native` (Metro) | platform-neutral composition (`WithAccounts` + the store) |
| `browser`              | platform-neutral composition (`WithAccounts` + the store) |
| `node` / default       | platform-neutral composition (`WithAccounts` + the store) |

Today all conditions resolve to the same composition: [`@algorandfoundation/accounts-core`](../core) (the reactive account store and its `WithAccounts` extension). Per-platform accounts packages will slot into the corresponding conditions later without any application-facing change.

Everything core exports is re-exported here, so both usage modes come with the one install: the accounts domain runs fully **standalone** as pure store functions over [@tanstack/store](https://tanstack.com/store), and ships first-class Provider support via `WithAccounts`.

## 📥 Installation

```bash
pnpm add @algorandfoundation/accounts
```

## 🚀 Quick Start

### Standalone: Pure Store Functions

```typescript
import { Store } from "@tanstack/store";
import { addAccount, type AccountStoreState, type Account } from "@algorandfoundation/accounts";

const store = new Store<AccountStoreState<Account>>({ wallets: {}, activeWallet: null });

addAccount({
  store,
  walletKey: "my-wallet",
  account: { name: "Account 1", address: "ADDRESS..." },
});
```

### With a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";

const MyProvider = Provider.withExtensions([WithAccounts]);
const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});

await provider.account.store.addAccount({ name: "Account 1", address: "ADDRESS..." });
```

See the [accounts-core README](../core/README.md) for the full store-function surface, hooks, and use-wallet interoperability.

## ⚙️ Configuration

The unified `WithAccounts` reads the single `options.accounts` namespace registered by the core (`AccountsNamespace`) and threads the `remote` block to the lazily loaded connections bridge. `await provider.account.store.ready` before initiating a connection to guarantee the mirror is mounted.

| Field                    | Type                         | Default                  | Provided by                                                                               |
| ------------------------ | ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `accounts.store`         | `Store<AccountStoreState>`   | new empty store          | `@algorandfoundation/accounts-core`                                                       |
| `accounts.hooks`         | `HookCollection`             | new collection           | `@algorandfoundation/accounts-core`                                                       |
| `accounts.walletKey`     | `WalletKey`                  | `provider.id`            | `@algorandfoundation/accounts-core`                                                       |
| `accounts.remote.expose` | `(accounts: T[]) => T[]`     | identity projection      | `@algorandfoundation/accounts-connections-extension`                                      |
| `accounts.keystore`      | `{ autoPopulate?: boolean }` | `{ autoPopulate: true }` | `@algorandfoundation/accounts-keystore-extension` (mounted explicitly, never by the meta) |

The production Algorand bridge (`@algorandfoundation/algorand-accounts-extension`, also mounted explicitly) owns the sibling `options.algorand` namespace (`network`, `algodConfig`, `indexerConfig?`, `hooks?`).

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/accounts/meta/).

## 📜 License

Apache-2.0
