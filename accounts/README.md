# Accounts Domain

The **Accounts** domain manages the on-chain account lifecycle. Accounts may be backed by keystore-managed keys, **or** sourced from third parties such as RPC services, indexers, or watch-only feeds; the store itself never assumes where an account comes from.

> 💡 **Recommended entry point:** use [`@algorandfoundation/accounts`](./meta) (the meta-package with conditional platform exports) unless you specifically need to compose the building blocks yourself.

## Responsibilities

- **Account lifecycle**: add, remove, look up, and activate accounts under a wallet key.
- **use-wallet interchangeability**: the state shape is a structural twin of [use-wallet](https://github.com/TxnLab/use-wallet) v5's store, so one TanStack store instance can back both a `WalletManager` and a Provider with the extension.
- **Source-agnostic state**: accounts can equally be derived from a keystore, imported, or fed by remote sources; bridges translate their sources into store mutations.

## Packages

This domain is split into a core package (the accounts API + store) and optional source bridges, with a meta-package on top that provides the conditional platform exports.

### Meta Package _(recommended)_

- [`@algorandfoundation/accounts`](./meta): keystore-style meta with conditional `exports` (`react-native` / `browser` / `node`). Owns the unified `WithAccounts` extension: the core account store plus the lazily loaded connections bridge (the session-scoped remote mirror at `provider.account.remote`); per-platform accounts packages will slot in later without any application-facing change.

### Building Blocks

- **Core** ([`@algorandfoundation/accounts-core`](./core)): types, the reactive account store, and the `WithAccounts` extension. Source-agnostic.
- **Source Bridges**
  - [`@algorandfoundation/accounts-keystore-extension`](./keystore-extension) _(example)_: reference bridge that populates the account store from keystore-derived keys (`WithAccountsKeystore`). It is mounted explicitly, as the meta never auto-composes it; a provider with a keystore only mints keystore-derived accounts when the app opts in. It exists to demonstrate the bridge pattern; the production Algorand accounts implementation is [`@algorandfoundation/algorand-accounts-extension`](./algorand-extension).
  - [`@algorandfoundation/algorand-accounts-extension`](./algorand-extension): the production bridge (`WithAlgorandAccounts`). Derives concrete Algorand addresses per key type (ed25519 public keys, canonical post-quantum digests for Falcon-1024), seeds balances / assets from algod and keeps them live through a contained watchlist subscriber.
  - [`@algorandfoundation/accounts-connections-extension`](./connections-extension): the connections bridge (`WithAccountsConnections`). Mounts the accounts store's session-scoped remote mirror at `provider.account.remote`, the surface the connections engines duck-type to exchange account records over a session.

## Architecture

```
        ┌────────────────────────────────────────────┐
        │             Wallet / Provider              │
        └───────────────────┬────────────────────────┘
                            │ uses
                ┌───────────▼────────────────┐
                │        WithAccounts        │  ← core extension (via meta)
                │   (accounts API + store)   │
                └───────────┬────────────────┘
                            │
        ┌───────────────────┼────────────────────────┐
        │                   │                        │
┌───────▼───────┐   ┌───────▼────────┐      ┌────────▼────────┐
│ Account Store │   │  Keystore      │      │   RPC / watch-  │
│  (generic)    │◀──│  bridge        │      │   only sources  │
│               │   │ (explicit)     │      │     (TODO)      │
└───────────────┘   └────────────────┘      └─────────────────┘
```

The keystore bridge is **mounted explicitly** alongside `WithAccounts`. If the app doesn't install `WithAccountsKeystore`, only the generic store is active, and accounts can still be populated from any other source. The bridge shown here is a reference example; the [`algorand-accounts-extension`](./algorand-extension) occupies the same slot as the production implementation.

## Configuration

The domain follows the two-level options registry: the core registers the non-generic `options.accounts` namespace (`AccountsNamespace`) on the shared `ExtensionOptions`, the bridges **augment** that interface (never re-registering the key), and the generic `*Options<T, S>` types narrow the same block to a concrete account / state type. The Algorand bridge additionally owns the sibling `options.algorand` namespace (`AlgorandNamespace`).

| Field                            | Type                        | Default             | Provided by                                                 |
| -------------------------------- | --------------------------- | ------------------- | ----------------------------------------------------------- |
| `accounts.store`                 | `Store<AccountStoreState>`  | new empty store     | [`accounts-core`](./core)                                   |
| `accounts.hooks`                 | `HookCollection`            | new collection      | [`accounts-core`](./core)                                   |
| `accounts.walletKey`             | `WalletKey`                 | `provider.id`       | [`accounts-core`](./core)                                   |
| `accounts.keystore.autoPopulate` | `boolean`                   | `true`              | [`accounts-keystore-extension`](./keystore-extension)       |
| `accounts.remote.expose`         | `(accounts: T[]) => T[]`    | identity projection | [`accounts-connections-extension`](./connections-extension) |
| `algorand.network`               | `string` (genesis id)       | required            | [`algorand-accounts-extension`](./algorand-extension)       |
| `algorand.algodConfig`           | `AlgoClientConfig`          | required            | [`algorand-accounts-extension`](./algorand-extension)       |
| `algorand.indexerConfig`         | `AlgoClientConfig`          | no indexer          | [`algorand-accounts-extension`](./algorand-extension)       |
| `algorand.hooks`                 | `HookCollection` (`"sign"`) | new collection      | [`algorand-accounts-extension`](./algorand-extension)       |

Both key-source bridges also read the keystore's `options.keystore.store`, and every bridge reports through `provider.log` when a `WithLogs` extension ([`@algorandfoundation/logs`](../logs)) is mounted.

## Related Domains

- [Keystore](../keystore): supplies the derived keys the keystore bridge converts into accounts.
- [Identities](../identities): accounts and identities frequently share a `metadata.keyId` lineage, allowing UIs to navigate from a DID to the accounts it can authorize.
- [Observability / Logs](../logs): account bridges can emit lifecycle events for auditing account changes.
