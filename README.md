# Wallet Provider Extensions

<!-- TODO: Add Heading with badges -->

Based on the work of the [Wallet Provider](https://github.com/algorandfoundation/wallet-provider),
this project adds support for various extensions that allow for cryptographic operations in specific contexts.

## What are Extensions?

Extensions are modular components that enhance the capabilities of a wallet or provider. They allow for the addition of specialized features—such as secret management, logging, or custom transaction signing—without bloating the core provider implementation. 

An extension typically consists of:
1.  **State**: Data managed by the extension (e.g., a list of stored secrets).
2.  **API**: A set of methods to interact with the extension and its state.

## Available Extensions

The following extension packages are available in this workspace:

- **[Keystore](./keystore)**: Securely manage cryptographic secrets and keys.
- **[BIP-39 Crypto](./crypto/bip39-crypto-extension)**: Support for BIP-39 mnemonic generation and management.
- **[XHD Crypto](./crypto/xhd-crypto-extension)**: Support for eXtended Hierarchical Deterministic (XHD) wallet operations.

## Extension Examples

### Keystore Extension

The Keystore extension provides a way to manage secrets.

```typescript
// Add a secret to the keystore
await provider.keystore.add({
  id: "my-key-id",
  name: "My Main Key",
  type: "algo25",
  value: "your secret mnemonic here...",
});

// Retrieve all secrets
const allSecrets = provider.secrets;
```

### BIP-39 Crypto Extension

The BIP-39 extension adds mnemonic generation and management capabilities.

```typescript
// Generate a new 24-word mnemonic
const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });

// Import a mnemonic into the provider's keystore
await provider.crypto.bip39.import({
  mnemonic: "...",
  id: "my-imported-key"
});
```

### XHD Crypto Extension

The XHD extension provides advanced cryptographic primitives and XHD wallet support.

```typescript
// Access XHD Wallet API
const xhdApi = provider.crypto.xhd;

// Use cryptographic primitives
const hash = provider.crypto.sha512_256("data to hash");

// Use base32
const encoded = provider.crypto.base32.encode(new Uint8Array([1, 2, 3]));
```

## Creating a New Extension

To create a new extension, you define an interface that combines your custom state and your API.

### Example: Logger Extension

Imagine you want an extension that logs all wallet activities.

#### 1. Define the Extension Types

```typescript
export interface LoggerState {
  logs: string[];
}

export interface LoggerApi {
  log: (message: string) => void;
  clear: () => void;
}

export interface LoggerExtension extends LoggerState {
  logger: LoggerApi;
}
```

#### 2. Implement the Extension

> [!IMPORTANT]
> When using a reflective store, Extensions MUST use `Object.defineProperty` for getters to allow for capturing any state changes.

```typescript
import { Store } from "@tanstack/store";
import type { Provider, ExtensionOptions } from "@algorandfoundation/wallet-provider";

const store = new Store<LoggerState>({ logs: [] });

export const loggerExtension: Extension<LoggerExtension> = (provider) => { 
    // Capture state changes by defining the property on the provider
    Object.defineProperty(provider, "logs", {
        get() {
            return store.state.logs;
        },
        enumerable: true,
        configurable: true,
    });

    return {
        logger: {
            log: (message: string) => {
                store.setState((state) => ({
                    logs: [...state.logs, `${new Date().toISOString()}: ${message}`],
                }));
            },
            clear: () => {
                store.setState(() => ({ logs: [] }));
            },
        },
    } as LoggerExtension;
}

export default loggerExtension;
```

## Using Extensions in a Provider

Extensions are designed to be used within a Wallet Provider. When initializing a provider, you can include these extensions to expose their functionality.

```typescript
import { KeystoreExtension } from "@algorandfoundation/keystore-extension";
import { BIP39CryptoExtension } from "@algorandfoundation/bip39-crypto-extension";
import { XHDCryptoExtension } from "@algorandfoundation/xhd-crypto-extension";
import { Provider } from "@algorandfoundation/wallet-provider";

// A Provider can be extended with multiple extensions using the withExtensions static method
const MyProvider = Provider.withExtensions([
    KeystoreExtension, 
    BIP39CryptoExtension, 
    XHDCryptoExtension
]);

const provider = new MyProvider(...);

// Now you can access extension APIs directly on the provider
const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });
```


## Acknowledgments

<!-- TODO: Refine acknowledgements as they develop -->

We would like to acknowledge the following individuals and entities for their contributions and inspiration to this project and the broader Algorand ecosystem:

- **Architectural Vision**: [Algorand Foundation](https://github.com/algorandfoundation) and [Bruno Martins](https://github.com/bmartins) (@bmartins) for his role as an Architect.
- **use-wallet**: [TxnLab](https://github.com/TxnLab) and [Doug Richar](https://github.com/drichar) (@drichar), along with [Gabriel Kuettel](https://github.com/gabrielkuettel) (@gabrielkuettel) (currently at Algorand Foundation), for their role in building the `use-wallet` hook.
- **Ecosystem Support**: The Engineering Teams at [Algorand Foundation](https://github.com/algorandfoundation) ranging from AlgoKit, Engineering, and Devrel for their role in providing ecosystem libraries and support.
- **Wallets**:
    - [Pera](https://github.com/perawallet) and [Will Beaumount](https://github.com/mjbeau) (@mjbeau) for their role in the ecosystem as a wallet and the large refactor to React Native.
    - [Akita](https://akita.community/) for their role in ARC58 adoption. With special thanks to Algorand Foundation engineering to [Kyle](https://github.com/kylebeee)(@kylebee) and [Joe Polny](https://github.com/joe-p)(@joe-p) for their contributions to the ARC58 plugin standards.
    - [Lute](https://github.com/lutewallet) and [Andrew Func](https://github.com/acfunc) (@acfunc) for their contributions to web wallets, readily adopting the latest features.
    - [Kibis-is](https://kibis.is/) and [Kieran Roneill](https://github.com/kieranroneill) (@kieranroneill) for their work as an extension-based wallet and contributions to ARC standards such as ARC27.
    - [Defly](https://defly.app/) and [Kevin Wellenzohn](https://github.com/k13n) (@k13n) for pioneering wallet features and deep engagement with the Algorand ecosystem and ARC standards.

<!-- TODO: Add Stars/Forks Badge -->

