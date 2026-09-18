# 👛🌉 @algorandfoundation/accounts-connections-extension

Bridge between the Account Store and Connections.

This package bridges the [Account Store](../core) and the [Connections](../../connections/core) domain seam. It mounts the accounts store's session-scoped **remote mirror** at `provider.account.remote`, the `{ expose, receive, revoke }` surface the connections engines duck-type (`discoverDomains`) to exchange account records over a session. The bridge itself mounts as the `WithAccountsConnections` Wallet Provider Extension; the accounts store it mirrors into runs fully standalone.

## ✨ Features

- **Session mirrors**: A remote peer's accounts land under a session-scoped wallet key (`remote:<sessionId>`) in the same reactive state the local wallets live in, and leave again when the session ends.
- **Data-only wire records**: `expose()` strips function members and excludes session mirrors (no echo); `receive()` re-attaches the session-routed `sign` from the receive context.
- **Outbound projection**: An optional `remote.expose` override filters or normalizes records (e.g. base64 public keys → canonical Algorand addresses) before they travel the wire.

## 🧱 Core Components

- [**`remoteAccountsMirror`**](./src/remote.ts): The pure store helper backing the mirror (`expose` / `receive` / `revoke`), plus the `remoteWalletKey` / `isRemoteWalletKey` helpers.
- [**`WithAccountsConnections`**](./src/extension.ts): The Wallet Provider Extension that mounts the mirror at `provider.account.remote`.

## 📥 Installation

```bash
pnpm add @algorandfoundation/accounts-connections-extension
```

## 🚀 Quick Start

### With a Provider

The `WithAccountsConnections` extension requires the **shared accounts store** (the same instance backing `WithAccounts`) via `options.accounts.store`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts-core";
import { WithAccountsConnections } from "@algorandfoundation/accounts-connections-extension";
import { Store } from "@tanstack/store";

const accountsStore = new Store({ wallets: {}, activeWallet: null });

const MyProvider = Provider.withExtensions([WithAccounts, WithAccountsConnections]);

const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    accounts: {
      store: accountsStore,
      // Optional: normalize records before they travel a connection.
      remote: { expose: (accounts) => accounts },
    },
  },
);
```

### Standalone

The mirror is pure store code and can be used without a provider:

```typescript
import { remoteAccountsMirror } from "@algorandfoundation/accounts-connections-extension";

const remote = remoteAccountsMirror(accountsStore, { walletKey: "my-wallet" });
remote.receive("session-1", peerAccounts, { sign: sessionSigner });
// ... the peer's accounts now ride the same reactive state ...
remote.revoke("session-1");
```

## ⚙️ Configuration

The bridge augments the core `options.accounts` namespace (`AccountsNamespace`) with a `remote` block (`AccountsRemoteNamespace`), so the composition root keeps one typed `options.accounts`:

| Field                    | Type                       | Required | Default             | Provided by                                          |
| ------------------------ | -------------------------- | -------- | ------------------- | ---------------------------------------------------- |
| `accounts.store`         | `Store<AccountStoreState>` | yes      | —                   | `@algorandfoundation/accounts-core`                  |
| `accounts.walletKey`     | `WalletKey`                | no       | `provider.id`       | `@algorandfoundation/accounts-core`                  |
| `accounts.remote.expose` | `(accounts: T[]) => T[]`   | no       | identity projection | `@algorandfoundation/accounts-connections-extension` |

The mirror's own `walletKey` always defaults to the extension's, so it is deliberately not part of `accounts.remote`. Other blocks (`accounts.keystore`, `accounts.hooks`, `options.algorand`) pass through untouched.

## 📄 License

Apache-2.0
