---
title: "Getting started"
description: Build your first wallet provider with a keystore, derive an account, and sign a message.
sidebar:
  order: 1
---

In this tutorial you will build a small but complete wallet core in Node.js. By the end you will have:

- a `Provider` composed with the keystore extension,
- a BIP39 seed and an HD root key stored behind your operating system keychain,
- a derived Ed25519 account that can sign and verify messages,
- a reactive store you can subscribe to from any UI.

You do not need any prior knowledge of this codebase. Some familiarity with TypeScript and async/await is enough.

## 1. Set up a project

This tutorial assumes you are working in **your own project**. Any Node.js app with TypeScript will do; install the packages and follow along:

```sh
npm install @algorandfoundation/wallet-provider @algorandfoundation/keystore @tanstack/store before-after-hook @scure/bip39
```

`@algorandfoundation/keystore` is the recommended **meta package**: it automatically resolves to the right platform keystore (Node.js in this tutorial, browser or React Native elsewhere) so your imports stay the same everywhere.

:::tip[Want a complete wallet to start from?]
If you would rather begin with a full, working wallet app than wire the packages up yourself, fork [Rocca](https://github.com/algorandfoundation/Rocca), the wallet product built on these packages, and customize it from there. This tutorial is still worth a read: it explains the building blocks Rocca is made of.
:::

A runnable version of this tutorial also ships in the [`examples/node-keystore`](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/examples/node-keystore) directory of the extensions repository, in case you want to see the finished result without setting anything up.

:::note
The keystore in this tutorial writes to your real OS keychain. When you are done, the `keystore clear` CLI command (shipped by `@algorandfoundation/keystore-node`, the platform package the meta package resolves to on Node.js) removes everything it created.
:::

## 2. Create a store and compose a provider

Everything in this system revolves around three pieces: a **store** that holds state, an **extension** that adds a capability, and a **provider** that ties them together. Create all three:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import type { KeyStoreState } from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

// The reactive store. It only ever holds metadata, never secrets.
const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

// Hooks let you observe operations later (logging, auditing).
const hooks = new Hook.Collection();

// Compose a provider class with the keystore extension, then instantiate it.
const NodeProvider = Provider.withExtensions([WithKeyStore]);
const provider = new NodeProvider(
  { id: "my-first-wallet", name: "My First Wallet" },
  { keystore: { store, hooks } },
);
```

Notice the symmetry: the keystore's configuration goes in at `options.keystore`, and its API comes out at `provider.key.store`. Every extension follows this pattern.

## 3. Wait for the keystore to be ready

The engine needs a moment to detect which cryptographic algorithms are available and to load any previously stored key metadata:

```typescript
await provider.key.store.ready;

console.log(provider.algorithms);
// [ { source: "host", algorithm: "Ed25519" }, { source: "shim", algorithm: "BIP32-Ed25519" }, ... ]
```

Each capability is tagged with where it came from. `host` means the built-in WebCrypto provided it, `shim` means one of the pluggable add-ons did.

## 4. Create a seed and derive an account

A wallet grows from a single seed. Mint a recovery phrase, import its bytes, then derive an HD root key and your first account:

```typescript
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

// Mint a 24-word phrase and import its seed bytes.
// The mnemonic itself never enters the store; show it to the user once.
const mnemonic = generateMnemonic(wordlist, 256);
const seed = await mnemonicToSeed(mnemonic);
const seedId = await provider.key.store.importSeed(seed, { name: "Wallet Seed" });

// Derive an HD (BIP32-Ed25519) root key from the seed.
const rootKeyId = await provider.key.store.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
  params: { parentKeyId: seedId },
});

// Derive the first Ed25519 account key along a BIP44 path.
const accountId = await provider.key.store.deriveFromSeed(rootKeyId, "m/44'/283'/0'/0/0");
```

All three calls return an **id**, not key material. The secret part of every key stays sealed inside the keystore. From here on you refer to keys by id and ask the keystore to act on your behalf.

## 5. Sign and verify a message

Time to use the account:

```typescript
const message = new TextEncoder().encode("hello from my first wallet");

const signature = await provider.key.store.sign(accountId, message);
const valid = await provider.key.store.verify(accountId, message, signature);

console.log(valid); // true
```

The private key never left the vault. You handed the keystore a message and got a signature back.

:::tip[Post-quantum ready]
Ed25519 is not the only first-class key. The same seed can back a **post-quantum Falcon-1024** key with one more `generate` call (`type: "falcon-1024"`), and `sign`/`verify` work identically. See [Derive a post-quantum Falcon-1024 key](/guides/manage-keys/#derive-a-post-quantum-falcon-1024-key).
:::

## 6. React to changes

Because the store is the single source of truth, any part of your app can subscribe to it. No polling, no manual refresh:

```typescript
const unsubscribe = store.subscribe(() => {
  console.log(`keys: ${store.state.keys.length}, status: ${store.state.status}`);
});

// Convenience getters on the provider read the same store.
console.log(provider.keys); // live list of key metadata
```

In React you would bind this with `useStore` from `@tanstack/react-store`; the same store works with Vue, Solid, Svelte, and Angular adapters too.

## What you built

A provider with one extension gave you a working wallet core: sealed key storage, HD derivation, signing, and reactive state. The rest of this project follows the same recipe. Accounts, identities, and logging are each just another store plus another extension on the same provider.

## Where to go next

- [Compose a provider with multiple extensions](/guides/compose-a-provider/)
- [Manage keys with the keystore](/guides/manage-keys/)
- [Manage accounts](/guides/manage-accounts/)
- [Connect a wallet and a dapp](/guides/connect-a-dapp/)
- [How the architecture fits together](/concepts/architecture/)
