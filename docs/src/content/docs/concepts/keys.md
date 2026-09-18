---
title: "Keys"
description: What keys are, how the keystore guards them, why it is split into several packages, and how the pieces click together.
sidebar:
  order: 3
---

A keystore is a safe place to create, store, and use secret keys. Think of it like a keyring for a house, but for digital keys:

- It can **make new keys**, from the classical Ed25519 keys behind a crypto wallet to post-quantum Falcon-1024 keys, both first-class citizens grown from the same seed.
- It **locks the secret part of each key away** so nothing else in your app can read it by accident.
- It can **use a key on your behalf**, for example to sign a message, without ever handing out the secret itself.
- It keeps a small, safe-to-show **list of what keys exist** so your app's screens can display them.

The golden rule: the secret part of a key never leaves the vault. Your app asks the keystore to "sign this" or "verify that", and only the results come back.

Like every package in this repo, the keystore works standalone, as `createKeyStore` and the platform engines built on it do not require a Provider (see the [keystore-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/keystore/core#readme)), while `WithKeyStore` provides first-class Provider integration.

## The big picture

The keystore is not one giant program. It is a small **shared engine** plus a few thin **adapters**, one per environment (Node.js, the browser, React Native). They all speak the same language, so your app code looks almost identical no matter where it runs.

```
Your app
   |
   v
Wallet Provider  (the app-wide context)
   |
   +-- Keystore extension  (adds "key.store" to the provider)
          |
          v
     Shared engine  (the shared brain: createKeyStore)
          |
   +------+---------------------+
   |                            |
   v                            v
 Shims                       Driver
 (add crypto algorithms)     (stores the sealed secrets on disk / in the OS)
```

Two ideas do most of the work:

- The **shared engine** contains all the tricky orchestration logic, written once.
- Everything that changes between platforms is **injected** into that engine: how secrets are stored (the driver) and which crypto algorithms are available (the shims).

Because the smart part is shared and the platform-specific parts are plugged in, adding a new platform means writing a small adapter, not a whole new keystore.

## Shims: how algorithms are added

Browsers and Node already know some cryptography through the built-in `SubtleCrypto` (part of the Web Crypto standard). But it does not know every algorithm this project needs, such as HD Ed25519 derivation or post-quantum Falcon signatures.

A **shim** solves this. A shim is a small wrapper that takes the built-in `SubtleCrypto`, teaches it one extra algorithm, and passes everything else straight through. You can stack several shims to add several algorithms.

| Shim                   | Algorithm            | What it adds                                        |
| ---------------------- | -------------------- | --------------------------------------------------- |
| `withSubtleXHD`        | `BIP32-Ed25519`      | Hierarchical Ed25519 key derivation and signing.    |
| `withSubtleFalcon1024` | `Falcon-1024`        | Post-quantum (quantum-resistant) signatures.        |
| `withSubtleDP256`      | `Deterministic-P256` | Deterministic passkey style keys.                   |
| `withSubtleBIP39`      | `BIP39`              | The classic 12/24-word recovery-phrase seed source. |
| `withSubtleAlgo25`     | `Algo25`             | Algorand's 25-word mnemonic seed source.            |

You almost never wire these by hand. If you do not tell the engine which shims to use, it enables a batteries-included default set: every algorithm whose supporting library is actually installed, quietly skipping the rest. You only pay for what you use, and the common case needs zero configuration.

Because different environments have different capabilities, the keystore reports what is actually active in its state under `algorithms`, with each entry tagged `source: "host"` (built-in) or `source: "shim"` (added).

## Drivers: how secrets are stored

The engine never decides **where** sealed secrets live. That job belongs to a **driver**, which each platform package supplies:

- **Web** stores non-extractable keys directly in the browser's IndexedDB.
- **React Native** seals secrets behind the device keychain, often protected by fingerprint or face unlock.
- **Node** seals material into the operating system keychain plus a sealed file.

The driver is a material custodian. It owns the encrypted-at-rest storage and any unlock flow (like a biometric prompt). The engine just asks it to store or fetch sealed bytes when needed. This clean split is why the same engine works everywhere.

## The state is always safe to render

The keystore keeps a `KeyStoreState` in a reactive store that holds:

- `keys`: the safe-to-show list of key metadata (never any secrets),
- `status`: what the keystore is doing right now (for example `idle`),
- `algorithms`: which crypto capabilities are currently active.

Nothing secret is ever placed in the store, so your UI can subscribe to it and render it directly.

## The RPC service

Sometimes one process holds the keys and another process wants to use them, without ever seeing the secrets. The Node package supports this with an RPC service:

- One process runs `keystore serve`. It hosts the real keystore and listens on a private local socket (not an open network port), so file permissions control who can talk to it.
- Another process uses a client engine that looks and behaves exactly like a normal keystore. Every call is forwarded over the socket, and only results come back.

Because the client fulfils the same contract as the in-process keystore, you can drop it into a provider the same way. Your code does not need to know it is talking to a remote keystore.

## Where to go next

- [Manage keys with the keystore](/guides/manage-keys/) for the concrete operations.
- [Packages](/concepts/packages/) for which keystore package to install where.
- The [API reference](/reference/) for the exact types and function signatures.
