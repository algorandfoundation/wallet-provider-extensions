# 🎫 @algorandfoundation/credentials-core

Verifiable Credential store **engine** and OID4VC utilities for Wallet Provider Extensions.

Like [`@algorandfoundation/keystore-core`](../../keystore/core), this package exports **no mounted extension** of its own. It provides the platform-neutral engine ([`createCredentialStore`](./src/engine.ts)) plus the shared contracts and utilities; the platform packages ([`credentials-web`](../web), [`react-native-credentials`](../react-native)) and the [`@algorandfoundation/credentials`](../meta) meta each export the `WithCredentials` extension that builds this engine with a platform-appropriate persistence driver.

## ✨ Features

- **Reactive State**: Built with [@tanstack/store](https://tanstack.com/store) for efficient state management and UI reactivity.
- **Hook-based Extensibility**: Leverages [before-after-hook](https://github.com/gr2m/before-after-hook) to allow for intercepting and extending credential operations.
- **Key/value persistence seam**: The engine hydrates from / persists to a tiny [`CredentialKeyValueStore`](./src/engine.ts) driver (shaped after the `KeyValueStore` of [`@algorandfoundation/provider-migrations`](../../migrations)) — MMKV, `localStorage`, AsyncStorage or IndexedDB adapt in two lines. Only the durable `credentials` slice is persisted; OID4VC sessions stay ephemeral.
- **Holder-binding seam**: No hard dependency on the identities extension. The [`HolderBinding`](./src/holder.ts) contract captures what the store needs from whatever owns credential holders (signer resolution + removal cascade); [`identityHolderBinding`](./src/holder.ts) is the canonical adapter over an [`@algorandfoundation/identities-store`](../../identities/store)-shaped store, and future holder sources (e.g. Digital Credentials API mDocs) plug in through the same seam.
- **OID4VC utilities**: Credential offer parsing and redemption (OID4VCI), authorization request parsing and VP tokens (OID4VP), SD-JWT VC parsing and presentation, `did:key` encoding/decoding, and JWS helpers.

## 🧱 Core Components

- [**`Credential`**](./src/types.ts): The Universal Wallet 2020-aligned interface for a held credential.
- [**`createCredentialStore`**](./src/engine.ts): The engine — reactive store + hooks + persistence driver + holder binding. Platform `WithCredentials` extensions are thin wrappers around it.
- [**`HolderBinding` / `identityHolderBinding`**](./src/holder.ts): The seam that decouples credentials from identities.
- [**`CredentialStoreApi`**](./src/types.ts): The API exposed at `provider.credential.store` (add, remove, get, list, query, session mirrors, `getSignerForIdentity`).
- [**`utils/`**](./src/utils): OID4VCI, OID4VP, SD-JWT VC, `did:key`, JWS, and base64url helpers.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-core
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead — it re-exports this package and selects the right platform implementation automatically.

## 🚀 Quick Start

### 1. Building the Engine

```typescript
import {
  createCredentialStore,
  identityHolderBinding,
  memoryCredentialDriver,
} from "@algorandfoundation/credentials-core";

const { api, store, ready } = createCredentialStore({
  // Any string key/value store adapts in two lines (MMKV, localStorage, ...).
  driver: memoryCredentialDriver(),
  // Optional: bind holders to an identities store for signer resolution
  // and cascade eviction. Without a binding the store still works.
  binding: identityHolderBinding(provider.identity.store),
});
await ready; // hydration from the driver has completed
```

> 💡 Applications normally never call this directly — they mount the
> `WithCredentials` extension from a platform package (or the meta), which
> builds the engine and auto-binds `identityHolderBinding` when an
> identities extension is present on the provider.

### 2. Managing Credentials

```typescript
// Store an issued credential, scoped to the holding identity
await api.addCredential({
  id: "sha256:...",
  type: ["VerifiableCredential"],
  identityAddress: "did:key:z6Mk...",
  name: "Device Attestation",
  format: "vc+sd-jwt",
  raw: compactSdJwt,
  receivedAt: Date.now(),
});

// Query (Universal Wallet 2020 QueryByExample)
const matches = await api.query([{ example: { type: "VerifiableCredential" } }]);

// With an identity holder binding, removing an identity cascade-evicts
// its credentials and sessions
await provider.identity.store.removeIdentity("did:key:z6Mk...");
```

### 3. Presenting a Credential

```typescript
import { buildCredentialPresentationHeader } from "@algorandfoundation/credentials-core";

const signer = await api.getSignerForIdentity("did:key:z6Mk...");
const header = await buildCredentialPresentationHeader({
  credential,
  signer,
  audience: "https://verifier.example.com",
  nonce: serverNonce,
});
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/core/).

## 📜 License

Apache-2.0
