# @algorandfoundation/xhd-crypto-extension

A Wallet Provider extension for XHD (Extended Hierarchical Deterministic) operations. This extension integrates the XHD Wallet API and essential cryptographic primitives like SHA-512/256 and Base32 into the Wallet Provider.

## Features

- **XHD Wallet API**: Full access to XHD wallet operations.
- **Cryptographic Primitives**: Includes `sha512_256` from `@noble/hashes` and `base32` from `@scure/base`.
- **Seamless Integration**: Designed to work as a standard extension for `@algorandfoundation/wallet-provider`.

## Installation

```bash
npm install @algorandfoundation/xhd-crypto-extension
```

## Usage

### Basic Initialization

To use the XHD extension, you need to initialize it within your wallet provider.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import WithXHDCryptoExtension from "@algorandfoundation/xhd-crypto-extension";

const provider = new Provider({
  // ... other options
  extensions: [WithXHDCryptoExtension],
});

// Access the XHD API
const xhdApi = provider.crypto.xhd;

// Generate a key (using a 96-byte extended root key)
const publicKey = await xhdApi.keyGen(
    rootKey,
    0, // KeyContext.Address
    0, // account
    0  // keyIndex
);

// Use cryptographic primitives
const hash = provider.crypto.sha512_256("data to hash");
const encoded = provider.crypto.base32.encode(new Uint8Array([1, 2, 3]));
```

## API Reference

The extension adds the following to the `provider.crypto` object:

### `provider.crypto.xhd`
An instance of `XHDWalletAPI` from `@algorandfoundation/xhd-wallet-api`.

### `provider.crypto.sha512_256`
The SHA-512/256 hash function from `@noble/hashes/sha2`.

### `provider.crypto.base32`
The Base32 encoding/decoding utility from `@scure/base`.