# 🔑🌉 @algorandfoundation/passkeys-keystore-extension

Bridge between the Passkeys store and the Keystore.

This package bridges the [Passkeys store](../core) and the [Keystore](../../keystore/core). It automatically populates the passkeys store with records backed by the keystore's derived P256 domain keys (the keys `deriveDomainKey` mints for WebAuthn credentials) and propagates passkey removals back to the keystore. The bridge itself mounts as the `WithPasskeysKeystore` Wallet Provider Extension, while both domains it connects run fully standalone; see [Standalone Usage](#-standalone-usage) below.

## ✨ Features

- **Auto-Population**: Automatically adds a passkey record when a compatible key (`hd-derived-p256` / `xhd-derived-p256` with a public key) is added to the Keystore, and refreshes it when the key's metadata changes.
- **Two-Way Removal**: Removing the key removes its passkey; removing a bridge-owned passkey from the passkeys store removes the backing keystore key. Both directions run over store observers and are echo-guarded, so nothing loops.
- **Public Fields Only**: Records carry the credential id (base64url of the key id), a display name, the public key, the algorithm, and the domain metadata; private key material never leaves the keystore.
- **Platform-Neutral**: Native credential deletion is the concern of `@algorandfoundation/react-native-passkeys` (its feeder observes the same store); this bridge never imports platform code.

## 🧱 Core Components

- [**`PasskeysKeystoreExtensionOptions`**](./src/types.ts): The options shape for the bridge (the keystore's `KeyStoreOptions` plus a required shared `passkeys.store`).
- [**`PasskeysKeystoreNamespace`**](./src/types.ts): The `options.passkeys.keystore` block this package registers on the shared `PasskeysNamespace` of `@algorandfoundation/passkeys-core`.
- [**`WithPasskeysKeystore`**](./src/extension.ts): The Wallet Provider Extension that bridges the stores. It contributes no API surface of its own; it only wires the two stores together.

## 📥 Installation

```bash
pnpm add @algorandfoundation/passkeys-keystore-extension
```

## 🚀 Quick Start

### With a Provider

#### 1. Adding the Extension to a Provider

The `WithPasskeysKeystore` extension requires both `WithPasskeys` and `WithKeyStore` (or a compatible keystore extension) to be present on the provider.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithPasskeys } from "@algorandfoundation/passkeys-core";
import { WithKeyStore } from "@algorandfoundation/react-native-keystore"; // or any keystore implementation
import { WithPasskeysKeystore } from "@algorandfoundation/passkeys-keystore-extension";

const MyProvider = Provider.withExtensions([WithKeyStore, WithPasskeys, WithPasskeysKeystore]);
```

#### 2. Configuration

When initializing the provider, you can configure the bridge behavior. The
bridge reads the shared `options.passkeys` and `options.keystore` namespaces
from the `ExtensionOptions` registry and **augments** the passkeys namespace
with its own `keystore` block, so everything below is typed at the composition
root:

| Option                           | Type                   | Default    | Registered by                                     | Description                                                                           |
| -------------------------------- | ---------------------- | ---------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `passkeys.store`                 | `Store<PasskeysState>` | _required_ | `@algorandfoundation/passkeys-core`               | The **shared** passkeys store (the same instance passed to `WithPasskeys`).           |
| `passkeys.keystore.autoPopulate` | `boolean`              | `true`     | `@algorandfoundation/passkeys-keystore-extension` | Mirror the keystore's derived P256 domain keys into the store and keep them in sync.  |
| `keystore.store`                 | `Store<KeyStoreState>` | _required_ | `@algorandfoundation/keystore-core`               | The reactive key store the bridge observes for added / removed / updated domain keys. |
| `keystore.hooks`                 | `HookCollection<any>`  | _required_ | `@algorandfoundation/keystore-core`               | Required by the keystore extension itself; the bridge does not read it.               |

```typescript
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    passkeys: {
      store: passkeysStore,
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

Once configured, any compatible domain keys added to the keystore automatically appear as passkeys:

```typescript
// Derive a P256 domain key in the keystore (a WebAuthn credential key).
await provider.key.store.deriveDomainKey(mainKeyId, {
  origin: "https://example.com",
  userHandle: "user-1",
});

// The passkey is automatically added to the passkeys store.
console.log(provider.passkeys);
// [{ credentialId: "...", name: "user-1@https://example.com", publicKey: ..., algorithm: "P256", ... }]

// Removing the passkey removes the backing keystore key too.
await provider.passkey.store.removePasskey(provider.passkeys[0].credentialId);
```

> **Note on identifiers**: the record's id field is `credentialId` (the base64url form of the backing key id). Earlier downstream copies of this bridge used a plain `id` field; migrating to this package means renaming that one field.

## 🧰 Standalone Usage

The `WithPasskeysKeystore` extension is Provider glue by design; it needs `WithPasskeys` and a keystore extension on the provider to bridge. The pieces it connects, however, are all usable without a Provider:

- **The passkeys domain** is pure store functions over `@tanstack/store` (`addPasskey`, `removePasskey`, `getPasskey`, `getPasskeys`, `clearPasskeys`) plus the pure `reconcilePasskeys` helper; see the [passkeys-core README](../core/README.md).
- **The keystore engine** (`createKeyStore` and the platform engines built on it) runs standalone; see the [keystore-core README](../../keystore/core/README.md).

If you drive both stores yourself (a standalone keystore engine plus a plain passkeys store), the sync logic this extension implements is exactly what you would replicate: subscribe to the keystore's store and call the passkeys-core functions; the [extension source](./src/extension.ts) is the reference for that wiring.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/passkeys/keystore-extension/).

## 📜 License

Apache-2.0
