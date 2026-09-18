# 🎫 @algorandfoundation/credentials-core

Verifiable Credential store **engine** and OID4VC utilities.

Everything in this package runs **standalone**; the platform-neutral engine ([`createCredentialStore`](./src/engine.ts)), the holder-binding seam and the OID4VC/SD-JWT/`did:key` utilities are plain factories and pure functions that need no Wallet Provider. The same engine also powers the **first-class Provider path**: like [`@algorandfoundation/keystore-core`](../../keystore/core), this package exports no mounted extension of its own, and the platform packages ([`credentials-node`](../node), [`credentials-web`](../web), [`react-native-credentials`](../react-native)), resolved by the [`@algorandfoundation/credentials`](../meta) meta, each export the `WithCredentials` extension that builds this engine with a platform-appropriate persistence driver. Both modes are equal citizens, allowing you to compose the engine directly or mount the extension. This package also owns the `options.credentials` namespace (`CredentialsNamespace`) on the shared `ExtensionOptions` registry, which the platform packages augment.

## ✨ Features

- **Reactive State**: Built with [@tanstack/store](https://tanstack.com/store) for efficient state management and UI reactivity.
- **Hook-based Extensibility**: Leverages [before-after-hook](https://github.com/gr2m/before-after-hook) to allow for intercepting and extending credential operations.
- **Key/value persistence seam**: The engine hydrates from / persists to a tiny [`CredentialKeyValueStore`](./src/engine.ts) driver (shaped after the `KeyValueStore` of [`@algorandfoundation/provider-migrations`](../../migrations)). MMKV, `localStorage`, AsyncStorage or IndexedDB adapt in two lines. Only the durable `credentials` slice is persisted; OID4VC sessions stay ephemeral.
- **Holder-binding seam**: No hard dependency on the identities extension. The [`HolderBinding`](./src/holder.ts) contract captures what the store needs from whatever owns credential holders (signer resolution + removal cascade); [`identityHolderBinding`](./src/holder.ts) is the canonical adapter over an [`@algorandfoundation/identities-core`](../../identities/core)-shaped store, and future holder sources (e.g. Digital Credentials API mDocs) plug in through the same seam.
- **OID4VC utilities**: Credential offer parsing and redemption (OID4VCI), authorization request parsing and VP tokens (OID4VP), SD-JWT VC parsing and presentation, `did:key` encoding/decoding, and JWS helpers.
- **Digital Credentials API contracts** _(experimental)_: [`DigitalCredentialsPlatform`](./src/digital-credentials.ts), which is the requester seam (`isSupported`/`get`/`create`) implemented per platform and attached at `provider.credential.digital`, and [`DigitalCredentialsProvider`](./src/digital-credentials.ts), the wallet/holder seam (credential registry + request handler) that future native modules (Android Credential Manager registry, iOS `IdentityDocumentServices`) will implement.

## 🧱 Core Components

- [**`Credential`**](./src/types.ts): The Universal Wallet 2020-aligned interface for a held credential.
- [**`createCredentialStore`**](./src/engine.ts): The engine, consisting of a reactive store, hooks, persistence driver, and holder binding. Platform `WithCredentials` extensions are thin wrappers around it.
- [**`HolderBinding` / `identityHolderBinding`**](./src/holder.ts): The seam that decouples credentials from identities.
- [**`CredentialStoreApi`**](./src/types.ts): The API exposed at `provider.credential.store` (add, remove, get, list, typed `query`, session mirrors, `getSignerForIdentity`, `ready`).
- [**`CredentialQuery` / `QueryByExample`**](./src/types.ts): The typed Universal Wallet 2020 query shapes accepted by `query`; unrecognized shapes match everything.
- [**`CredentialsNamespace` / `CredentialStoreOptions`**](./src/types.ts): The `options.credentials` block every credentials extension reads (see [Configuration](#%EF%B8%8F-configuration)).
- [**`utils/`**](./src/utils): OID4VCI, OID4VP, SD-JWT VC, `did:key`, JWS, and base64url helpers.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-core
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead, as it re-exports this package and selects the right platform implementation automatically.

## 🚀 Quick Start

### 1. Building the Engine (standalone, no Provider required)

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

> 💡 This standalone engine is a fully supported way to run the credential
> store. The equally first-class Provider path is the `WithCredentials`
> extension from a platform package (or the meta), which builds this same
> engine and auto-binds `identityHolderBinding` when an identities extension
> is present on the provider. Everything below works identically through
> `provider.credential.store`.

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

// Query (Universal Wallet 2020 QueryByExample; typed as CredentialQuery[])
const matches = await api.query([
  { type: "QueryByExample", example: { type: "VerifiableCredential" } },
]);

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

## ⚙️ Configuration

The platform `WithCredentials` extensions read the shared `options.credentials` block, typed as `CredentialsNamespace` and registered on `ExtensionOptions` by this package. Everything is optional; platform packages **augment** this interface for their own seams (e.g. `digitalCredentialsModule` from `react-native-credentials`) instead of registering a second `credentials` key. The standalone `createCredentialStore` accepts the same members (plus `log`) as `CreateCredentialStoreOptions`.

| Field                    | Type                          | Default                                                     | Description                                                                             |
| ------------------------ | ----------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `credentials.store`      | `Store<CredentialStoreState>` | new empty store                                             | Reactive TanStack store backing the engine (also read by `WithCredentialsConnections`). |
| `credentials.hooks`      | `HookCollection`              | new collection                                              | `before-after-hook` collection guarding every store operation (exposed as `api.hooks`). |
| `credentials.driver`     | `CredentialKeyValueStore`     | platform default, else in-memory                            | String key/value persistence seam for the durable `credentials` slice.                  |
| `credentials.binding`    | `HolderBinding`               | `identityHolderBinding(provider.identity.store)` when found | Signer resolution + removal cascade for credential holders.                             |
| `credentials.storageKey` | `string`                      | `DEFAULT_CREDENTIALS_KEY`                                   | Key under which the snapshot is serialized in the driver.                               |

```typescript
declare module "@algorandfoundation/credentials-core" {
  interface CredentialsNamespace {
    // a platform package adding its own seam
    databaseName?: string;
  }
}
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/core/).

## 📜 License

Apache-2.0
