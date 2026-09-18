# 🆔🌉 @algorandfoundation/identities-keystore-extension

Bridge between Identity Store and Keystore.

This package bridges the [Identity Store](../core) and the [Keystore](../../keystore/core). It automatically populates the identity store with identities derived from keys in the keystore (specifically context 1) and provides a signing method that leverages the keystore backend. The bridge itself mounts as the `WithIdentitiesKeystore` Wallet Provider Extension, while both domains it connects run fully standalone; see [Standalone Usage](#-standalone-usage) below.

> 💡 The [`@algorandfoundation/identities`](../meta) meta package's composed `WithIdentities` loads this bridge for you whenever the provider carries a keystore. Mount `WithIdentitiesKeystore` directly only when composing the building blocks yourself.

## ✨ Features

- **Auto-Population**: Automatically adds identities to the Identity Store when compatible keys (context 1) are added to the Keystore.
- **Integrated Signing**: Provides a `sign` method on identities that automatically uses the Keystore for cryptographic operations.
- **Identity Recovery**: Recreates keystore state (derived keys) from a DID Document via `restoreFromDidDocument`.

## 🧱 Core Components

- [**`IdentitiesKeystoreExtension`**](./src/types.ts): Interface for the augmented identity store with recovery capabilities.
- [**`WithIdentitiesKeystore`**](./src/extension.ts): The Wallet Provider Extension that bridges the stores.
- [**`IdentitiesKeystoreNamespace`**](./src/types.ts): The `identities.keystore` block this package adds to the shared `options.identities` namespace.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities-keystore-extension
```

## 🚀 Quick Start

### With a Provider

#### 1. Adding the Extension to a Provider

The `WithIdentitiesKeystore` extension requires both `WithIdentities` (from `@algorandfoundation/identities-core`) and `WithKeyStore` (or a compatible keystore extension) to be present on the provider.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithKeyStore } from "@algorandfoundation/react-native-keystore"; // or any keystore implementation
import { WithIdentitiesKeystore } from "@algorandfoundation/identities-keystore-extension";

const MyProvider = Provider.withExtensions([WithIdentities, WithKeyStore, WithIdentitiesKeystore]);
```

#### 2. Configuration

When initializing the provider, you can configure the bridge behavior:

```typescript
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    identities: {
      store: identityStore,
      hooks: identityHooks,
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

#### 3. Usage

Once configured, any compatible keys (`hd-derived-ed25519` with `metadata.context: 1`) added to the keystore will automatically appear as identities:

```typescript
// Derive an identity key (context 1) in the keystore:
// import the seed, grow the XHD root key, then derive on the identity path.
const seedId = await provider.key.store.importSeed(seedBytes);
const rootId = await provider.key.store.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["sign"],
  params: { parentKeyId: seedId },
});
await provider.key.store.deriveFromSeed(rootId, "m/44'/0'/0'/0/0", {
  algorithm: "EdDSA",
  metadata: { context: 1, account: 0, index: 0 },
});

// The identity is automatically added to the identity store
console.log(provider.identities);

// Sign using the identity's sign method
const identity = provider.identities[0];
const signed = await identity.sign([txnData]);

// Restore the derived keys a backed-up DID document describes
await provider.identity.store.restoreFromDidDocument(backupDocument);
```

## ⚙️ Configuration

The bridge reads two blocks of the shared options registry:

| Option                             | Type                        | Required | Description                                                                                                                    |
| ---------------------------------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `identities.store`                 | `Store<IdentityStoreState>` | yes      | The **shared** identity store, the same instance handed to `WithIdentities`.                                                   |
| `identities.hooks`                 | `HookCollection`            | no       | Threaded through to `WithIdentities`; the bridge does not read it.                                                             |
| `identities.keystore.autoPopulate` | `boolean` (default `true`)  | no       | Subscribe to the keystore and mirror identity-context keys into identities (and keep their DID documents in sync). Added here. |
| `keystore.store`                   | `Store<KeyStoreState>`      | yes      | The keystore's reactive store (from `@algorandfoundation/keystore-core`'s `options.keystore`), watched for key changes.        |

## 🧰 Standalone Usage

The `WithIdentitiesKeystore` extension is Provider glue by design; it needs `WithIdentities` and a keystore extension on the provider to bridge. The pieces it connects, however, are all usable without a Provider:

- **The identities domain** is pure store functions over `@tanstack/store` (`addIdentity`, `removeIdentity`, `getIdentity`, `updateIdentityMetadata`, …) plus pure DID helpers (`generateDidKey`, `generateDidDocument`); see the [identities-core README](../core/README.md).
- **The keystore engine** (`createKeyStore` and the platform engines built on it) runs standalone; see the [keystore-core README](../../keystore/core/README.md).
- **Encoding utilities** (`decodeAddress`, `toBase64URL`, `fromUrlSafe`) are exported directly from this package as pure functions:

```typescript
import { decodeAddress, toBase64URL } from "@algorandfoundation/identities-keystore-extension";

const { publicKey } = decodeAddress("ALGORANDADDRESS...");
const encoded = toBase64URL(publicKey);
```

If you drive both stores yourself (a standalone keystore engine plus a plain identity store), the sync logic this extension implements is exactly what you would replicate: subscribe to the keystore's store and call the identities-core functions; the [extension source](./src/extension.ts) is the reference for that wiring.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/keystore-extension/).

## 📜 License

Apache-2.0
