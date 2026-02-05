# Keystore Extension

The Keystore extension is a core component for the Algorand Wallet Provider, designed to securely manage cryptographic secrets. It provides a standardized interface for secret lifecycle management, including storage, retrieval, and removal of various secret types.

## Features

- **Standardized Secret Interface**: Use a consistent `SecretKey` format across different cryptographic standards.
- **Multiple Secret Types**: Supports `algo25`, `bip39`, `intermezzo`, and custom token types.
- **Modular Design**: Built to work seamlessly with the `@algorandfoundation/wallet-provider` as an extension.
- **State Management**: Powered by `@tanstack/store` for predictable state transitions.

## Installation

```bash
npm install @algorandfoundation/keystore-extension
```

## Usage

### 1. Define the Keystore State

Initialize a TanStack store with the `KeyStoreState` shape.

```typescript
import { Store } from "@tanstack/store";
import { KeyStoreState } from "@algorandfoundation/keystore-extension";

const store = new Store<KeyStoreState>({
  secrets: []
});
```

### 2. Implement the Extension

While the package provides types and helper functions, you can compose your extension using the provided `KeyStoreApi`.

```typescript
import { Extension } from "@algorandfoundation/wallet-provider";
import { KeyStoreExtension, SecretKey, addSecret, removeSecret, getSecret } from "@algorandfoundation/keystore-extension";

const keystoreExtension: Extension<KeyStoreExtension> = {
  get secrets() {
    return store.state.secrets;
  },
  keystore: {
    add: async (key: SecretKey) => {
      addSecret(store, key);
      return key;
    },
    remove: async (id: string) => {
      removeSecret(store, id);
    },
    import: async (key: SecretKey) => {
      // Implement specific import logic here
      addSecret(store, key);
      return key;
    },
    export: async (id: string) => {
      const key = getSecret(store, id);
      if (!key) throw new Error("Key not found");
      return key;
    }
  }
};
```

### 3. Use in a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";

const provider = new Provider(...) as Provider & KeyStoreExtension;
// Assign the extension to the provider instance
Object.defineProperties(
  provider,
  Object.getOwnPropertyDescriptors(keystoreExtension),
);

// Access keystore methods
await provider.keystore.add({
  id: "my-key-1",
  name: "Main Account",
  type: "algo25",
  value: "..." 
});
```

## Supported Secret Types

- `algo25`: Algorand 25-word mnemonic.
- `bip39`: BIP39 mnemonic standard.
- `intermezzo`: Tokens for Intermezzo vaults.
- `pera`: Pera Wallet specific tokens.

## Tips & Best Practices

- **Security First**: Always ensure the `value` of a `SecretKey` is handled with care. Consider using non-exportable keys where possible (setting `value` to `null`).
- **Unique Identifiers**: Use stable and unique `id`s for secrets to prevent accidental overwrites or removal of the wrong keys.
- **Metadata**: Leverage the `metadata` field to store non-sensitive information like creation dates, provider-specific metadata, etc.
- **Validation**: Validate secret formats before adding them to the store to ensure compatibility with your cryptographic operations.