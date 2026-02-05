# @algorandfoundation/bip39-crypto-extension

A Wallet Provider extension for BIP-39 mnemonic generation and management. This extension allows you to generate, import, export, and manage BIP-39 mnemonics, optionally integrating with a Keystore for secure storage.

## Installation

```bash
npm install @algorandfoundation/bip39-crypto-extension
```

## Usage

### Basic Initialization

To use the BIP-39 extension, you need to initialize it within your wallet provider.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import WithBip39CryptoExtension from "@algorandfoundation/bip39-crypto-extension";

const provider = new Provider({
  // ... other options
  extensions: [WithBip39CryptoExtension],
});

// Access the BIP-39 API
const mnemonic = await provider.crypto.bip39.generate();
console.log(mnemonic.value); // The generated 24-word mnemonic
```

### Integration with Keystore

If you want to store the mnemonics securely, you should use it alongside the `keystore-extension`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import WithKeystoreExtension from "@algorandfoundation/keystore-extension";
import WithBip39Extension from "@algorandfoundation/bip39-crypto-extension";

const provider = new Provider({
  extensions: [WithKeystoreExtension, WithBip39Extension],
});

// Generate and add to keystore
const secret = await provider.crypto.bip39.add({ name: "My Recovery Phrase" });

// Import an existing mnemonic
await provider.crypto.bip39.import({
  mnemonic: "your 24 word mnemonic here ...",
  name: "Imported Account"
});

// List and remove
const mySecrets = provider.secrets;
await provider.crypto.bip39.remove(secret.id);
```

## Lifecycle Hooks

The extension uses `before-after-hook` to allow you to intercept and modify behavior before or after specific operations. This is useful for logging, auditing, or adding custom validation.

Available hooks: `generate`, `add`, `import`, `export`, `remove`.

### Example: Logging Hook

```typescript
import { cryptoBip39Hooks } from "@algorandfoundation/bip39-crypto-extension";

// Log before a mnemonic is generated
cryptoBip39Hooks.before("generate", (options) => {
  console.log("Generating a new mnemonic with options:", options);
});

// Audit after a mnemonic is imported
cryptoBip39Hooks.after("import", (result) => {
  console.log("Mnemonic imported successfully with ID:", result.id);
});

// Custom error handling
cryptoBip39Hooks.error("export", (error, options) => {
  console.error("Failed to export mnemonic:", error.message);
  throw error; // Re-throw or handle as needed
});
```

## API Reference

### `provider.crypto.bip39.generate(options?)`
Generates a new BIP-39 mnemonic without storing it.

### `provider.crypto.bip39.add(options?)`
Generates a new BIP-39 mnemonic and adds it to the keystore. (Requires `keystore-extension`)

### `provider.crypto.bip39.import(options)`
Validates and imports an existing mnemonic into the keystore. (Requires `keystore-extension`)

### `provider.crypto.bip39.export(id)`
Retrieves a mnemonic from the keystore by ID. (Requires `keystore-extension`)

### `provider.crypto.bip39.remove(id)`
Removes a mnemonic from the keystore by ID. (Requires `keystore-extension`)

