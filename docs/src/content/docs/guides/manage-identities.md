---
title: "Manage identities"
description: Create DIDs, keep their documents fresh, restore from a backup, and anchor on chain.
sidebar:
  order: 4
---

This guide covers the identity operations: creating identities, letting the keystore drive them, backing up and restoring through DID documents, and anchoring on chain. For the model behind it, read [Identities](/concepts/identities/) first.

## Set up the extension

The `WithIdentities` meta extension is the recommended entry point. It mounts the identity store and, when the provider also has a keystore, lazily loads the keystore bridge for you:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import { WithIdentities } from "@algorandfoundation/identities";
import type { Identity, IdentityStoreState } from "@algorandfoundation/identities";
import { Store } from "@tanstack/store";

const identityStore = new Store<IdentityStoreState>({ identities: [] });

const MyProvider = Provider.withExtensions([WithKeyStore, WithIdentities]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    keystore: { store: keyStore },
    identities: { store: identityStore },
  },
);
```

If you want only the plain store with no keystore coupling, compose `WithIdentities` from `@algorandfoundation/identities-core` instead (same name, store only, no bridges).

## Create a did:key identity by hand

Any Ed25519 public key can become a self-describing DID. The core package ships the helpers:

```typescript
import { generateDidKey, generateDidDocument } from "@algorandfoundation/identities-core";

const did = generateDidKey(publicKey);
await provider.identity.store.addIdentity({
  address: did,
  did,
  type: "did:key",
  didDocument: generateDidDocument(did, publicKey),
});
```

Reads work like every other domain: `provider.identities` is a live getter, `provider.identity.store.getIdentity(address)` fetches one record, and the store emits `add`, `remove`, `get`, `clear`, `updateDidDocument`, and `updateMetadata` hooks.

The `service` array of a generated document is exactly what you pass as `additionalServices`; the core injects no default services, so transport-specific entries (say, a WebRTC ICE service for connections) are added by the package that owns that transport.

## Let the keystore drive identities

With the bridge active, you rarely add identities by hand. Derive a key under the identity context and the bridge does the rest:

- every identity-context key becomes an identity with a `did:key` and a projected DID document,
- when keys in the seed's hierarchy change, every affected document refreshes,
- removing the key removes the identity.

Update a document explicitly only for identities you own outside the bridge, and use `updateIdentityMetadata` to shallow-merge application data (labels, anchor snapshots) into an identity's `metadata` without touching its document:

```typescript
await provider.identity.store.updateDidDocument(did, updatedDocument);
await provider.identity.store.updateIdentityMetadata(did, { label: "Work persona" });
```

## Back up and restore through the DID document

The projected document describes every derived key, so it works as a backup format. Restoring is three steps: import the recovery phrase, grow the HD root key from it, then hand the document to the bridge:

```typescript
// 1. The seed must be back first; the document only describes derivation paths.
const seedId = await provider.key.store.importSeed(seed, { name: "Restored Seed" });

// 2. Re-create the HD root key the derivations hang off.
await provider.key.store.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
  params: { parentKeyId: seedId },
});

// 3. Re-derive exactly the keys the document describes.
await provider.identity.store.restoreFromDidDocument(backupDocument);
```

After the restore, the keystore holds the same derived keys as before, and the bridge rebuilds the identities from them. `restoreFromDidDocument` throws if the keystore has no root key, so keep the order above.

## Anchor an identity on chain

To make an identity resolvable on Algorand as a `did:algo`, mount the Intermezzo bridge (`WithIntermezzoIdentities` from `@algorandfoundation/identities-intermezzo-extension`, configured through the shared `options.intermezzo` block) and anchor it. The bridge records the anchor snapshot through `updateIdentityMetadata`, so it appears under `identity.metadata.anchor`:

```typescript
const { submitResponse } = await provider.identity.intermezzo.anchorIdentity({
  identityAddress: "did:key:z6Mk...",
  credentialPresentation: compactSdJwtVc,
});
console.log(submitResponse.did); // did:algo:...
```

The `credentialPresentation` must be a compact SD-JWT VC presentation of the device-attestation credential, which proves the anchoring wallet actually controls the keys.

## Related

- [Identities](/concepts/identities/) for the model and the document projection.
- [Hold verifiable credentials](/guides/hold-credentials/) for the credential layer bound to identities.
- [Add a new account or identity type](/guides/add-account-types/) for custom identity shapes.
