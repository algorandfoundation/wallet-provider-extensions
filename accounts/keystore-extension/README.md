# 🌉 @algorandfoundation/accounts-keystore-extension

**Example** bridge between Account Store and Keystore.

This package bridges the [Account Store](../core) and the [Keystore](../../keystore/core). It automatically populates the account store with accounts derived from keys in the keystore and provides a signing method that leverages the keystore backend. The bridge itself mounts as the `WithAccountsKeystore` Wallet Provider Extension, while both domains it connects run fully standalone; see [Standalone Usage](#-standalone-usage) below.

> [!NOTE]
> This extension is an **example**: a reference implementation for how to build account bridges between a key source and the account store. It does not have much functionality outside of bridging these two specific stores together. The production Algorand accounts implementation is the [**`algorand-accounts-extension`**](../algorand-extension); use this package to learn the bridge pattern or as a starting point for your own.

## ✨ Features

- **Auto-Population**: Automatically adds accounts to the Account Store when keys are added to the Keystore (`hd-derived-ed25519`, standalone `ed25519`, and post-quantum `falcon-1024` keys).
- **Integrated Signing**: Provides a `sign` method on accounts that automatically uses the Keystore for cryptographic operations.
- **Reactive Synchronization**: Subscribes to Keystore changes to keep the Account Store in sync.
- **Public-Key Addressing**: Every account is keyed by the base64 of its key's public key (deliberately simple for an example). Concrete chain addressing (Algorand addresses, canonical post-quantum digests) lives in chain-specific extensions such as the [algorand-accounts extension](../algorand-extension).
- **Account Kind Metadata**: Every populated account records the backing key's type as `metadata.keyType`, so consumers can label HD vs Ed25519 vs Falcon accounts.

## 🧱 Core Components

- [**`KeystoreAccount`**](./src/types.ts): An account type that includes a `sign` method backed by the Keystore.
- [**`WithAccountsKeystore`**](./src/extension.ts): The Wallet Provider Extension that bridges the stores.

## 📥 Installation

```bash
pnpm add @algorandfoundation/accounts-keystore-extension
```

## 🚀 Quick Start

### With a Provider

#### 1. Adding the Extension to a Provider

The `WithAccountsKeystore` extension requires both `WithAccounts` and `WithKeyStore` (or a compatible keystore extension) to be present on the provider.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithKeyStore } from "@algorandfoundation/react-native-keystore"; // or any keystore implementation
import { WithAccountsKeystore } from "@algorandfoundation/accounts-keystore-extension";

const MyProvider = Provider.withExtensions([WithAccounts, WithKeyStore, WithAccountsKeystore]);
```

#### 2. Configuration

When initializing the provider, you can configure the bridge behavior:

```typescript
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    accounts: {
      store: accountStore,
      hooks: accountHooks,
      keystore: {
        autoPopulate: true, // Default is true
      },
    },
    keystore: {
      store: keyStore,
      hooks: keyStoreHooks,
    },
  },
);
```

The bridge augments the core `options.accounts` namespace (`AccountsNamespace`) with a `keystore` block, and reads the keystore's own `options.keystore` namespace, so both stay in one typed options bag at the composition root:

| Field                            | Type                       | Required | Default       | Provided by                                       |
| -------------------------------- | -------------------------- | -------- | ------------- | ------------------------------------------------- |
| `accounts.store`                 | `Store<AccountStoreState>` | yes      | —             | `@algorandfoundation/accounts-core`               |
| `accounts.hooks`                 | `HookCollection`           | no       | —             | `@algorandfoundation/accounts-core`               |
| `accounts.walletKey`             | `WalletKey`                | no       | `provider.id` | `@algorandfoundation/accounts-core`               |
| `accounts.keystore.autoPopulate` | `boolean`                  | no       | `true`        | `@algorandfoundation/accounts-keystore-extension` |
| `keystore.store`                 | `Store<KeyStoreState>`     | yes      | —             | `@algorandfoundation/keystore-core`               |

The `accounts.remote` block (`@algorandfoundation/accounts-connections-extension`) and the `options.algorand` namespace (`@algorandfoundation/algorand-accounts-extension`) are unrelated to this bridge and pass through untouched. When a `WithLogs` extension is mounted, the bridge reports its sync activity through `provider.log`.

#### 3. Usage

Once configured, any compatible keys (`hd-derived-ed25519`, `ed25519`, `falcon-1024`) added to the keystore will automatically appear as accounts:

```typescript
// Generate a key in the keystore
await provider.key.store.generate({
  type: "ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign", "verify"],
});

// The account is automatically added to the account store
console.log(provider.accounts);

// Sign using the account's sign method
const account = provider.accounts[0];
const signed = await account.sign([txnData]);
```

## 🧰 Standalone Usage

The `WithAccountsKeystore` extension is Provider glue by design; it needs `WithAccounts` and a keystore extension on the provider to bridge. The pieces it connects, however, are all usable without a Provider:

- **The accounts domain** is pure store functions over `@tanstack/store` (`addAccount`, `removeAccount`, `getAccount`, …); see the [accounts-core README](../core/README.md).
- **The keystore engine** (`createKeyStore` and the platform engines built on it) runs standalone; see the [keystore-core README](../../keystore/core/README.md).
- **Concrete chain addressing** (Algorand addresses via `encodeAddress`, canonical post-quantum digests via `canonicalPQAddress`) lives in the [algorand-accounts extension](../algorand-extension), where the addressing helpers are exported as pure functions, requiring no Provider, store, or keystore.

If you drive both stores yourself (a standalone keystore engine plus a plain account store), the sync logic this extension implements is exactly what you would replicate: subscribe to the keystore's store and call the accounts-core functions; the [extension source](./src/extension.ts) is the reference for that wiring.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/accounts/keystore-extension/).

## 📜 License

Apache-2.0
