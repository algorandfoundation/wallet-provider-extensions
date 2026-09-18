---
title: "Track passkeys"
description: Mirror the wallet's passkeys into a reactive store and reconcile them against your server.
sidebar:
  order: 8
---

Passkey secrets live in platform credential stores (the OS keychain, a security key) or the wallet's keystore, not in your UI. The passkeys domain keeps a **public-record inventory** of them in wallet state, so you can render a passkey list, spot drift between wallet and server, and manage entries, all without any private key material entering JavaScript.

Like every package in this repo, passkeys work standalone: the domain is pure store functions (`addPasskey`, `removePasskey`, `getPasskey`, `getPasskeys`, `clearPasskeys`) over a TanStack store that do not require a Provider (see the [passkeys-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/passkeys/core#readme)), while `WithPasskeys` provides first-class Provider integration as used below.

## Set up the extension

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithPasskeys } from "@algorandfoundation/passkeys-core";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";
import { Store } from "@tanstack/store";

const passkeysStore = new Store<PasskeysState>({ passkeys: [] });

const MyProvider = Provider.withExtensions([WithPasskeys]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  { passkeys: { store: passkeysStore } },
);
```

The store is the single seam: **feeders** write into the same instance. Two ship in this repo:

- `@algorandfoundation/passkeys-keystore-extension` mirrors the keystore's derived P256 domain keys (the wallet's own WebAuthn credential keys) into the store; mount `WithPasskeysKeystore` after `WithKeyStore` and `WithPasskeys`.
- `@algorandfoundation/react-native-passkeys` syncs the native credential provider: its `WithPasskeys` composes the core extension with the native feeder (pass the autofill module via `passkeys.module`).

## What a passkey record looks like

```typescript
export interface Passkey {
  credentialId: string; // base64url
  name?: string; // display name, e.g. "user@origin"
  publicKey?: Uint8Array; // public material only
  algorithm?: string; // e.g. "P256"
  rpId?: string;
  userName?: string;
  parentKeyId?: string;
  serverStatus?: "known" | "unknown";
  reconciledAt?: number;
  metadata?: Record<string, unknown>; // feeder-specific, e.g. the backing keyId
}
```

Public fields only: which credential, for which relying party, for which user, and at most the public key. The private key stays in the platform's secure hardware or the keystore.

## List and manage entries

```typescript
await provider.passkey.store.addPasskey({ credentialId: "q2Zt...", rpId: "example.com" });
console.log(provider.passkeys); // live getter over the store

await provider.passkey.store.removePasskey(credentialId); // drop an entry
```

Removals propagate through store observers: the keystore bridge removes the backing keystore key of a bridge-owned passkey, and the react-native feeder deletes the backing native credential of a native-sourced one.

## Reconcile against your server

Wallets and servers drift: a passkey deleted on the server still exists locally, and vice versa. `reconcile` compares the store's records with a WebAuthn request from your server and reports both directions:

```typescript
const { strays, missing } = await provider.passkey.store.reconcile(serverOptions);
// strays: held locally but unknown to the server
// missing: expected by the server but absent locally
```

Each reconciled entry is stamped with `serverStatus` and `reconciledAt`, so the UI can flag stale credentials without re-running the check.

## Platform probes (React Native)

On React Native, the provider-status probes live on the platform surface of `@algorandfoundation/react-native-passkeys`:

```typescript
await provider.passkey.ready; // initial native sync
await provider.passkey.refresh(); // re-sync from the native module

const active = await provider.passkey.providerActive();
if (!active) {
  await provider.passkey.openProviderSettings(); // take the user to enable it
}
```

`providerActive` reports whether your app is the device's active credential provider, and `openProviderSettings` deep-links to the system screen where the user can turn it on.

## How this relates to the keystore

The passkeys store never touches private keys. When the wallet derives passkey-style keys itself it goes through the keystore's `Deterministic-P256` shim, which derives domain-specific P-256 keys from the wallet seed; that is what makes such passkeys reproducible from a recovery phrase on a new device. The `WithPasskeysKeystore` bridge mirrors those keys into the passkeys store as records whose `metadata.keyId` ties each passkey back to the key that produced it, and removing the passkey removes the key again.

## Related

- [Keys](/concepts/keys/) for the shims, including Deterministic-P256.
- [Connections](/concepts/connections/) for how passkey metadata is shared with a session peer.
