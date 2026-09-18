# 🆔 @algorandfoundation/identities-core

Basic reactive state management for identities.

This package provides a standardized way to manage and interact with identity data (DIDs, DID Documents) in a reactive way. It runs fully **standalone** via pure store functions (`addIdentity`, `removeIdentity`, `getIdentity`, `updateIdentityDidDocument`, `updateIdentityMetadata`, `clearIdentities`) and DID helpers (`generateDidKey`, `generateDidDocument`) over a plain [@tanstack/store](https://tanstack.com/store) `Store`, no Provider required. It also ships first-class support for the Algorand Wallet Provider via the `WithIdentities` extension. Both usage modes are equal citizens of the API.

> 💡 **Core = store only, meta = core + bridges.** This package's `WithIdentities` mounts the identity store and nothing else. The [`@algorandfoundation/identities`](../meta) meta package exports a **composed** `WithIdentities` (same name, same `options.identities` block) that additionally loads the keystore and connections bridges. Pick the core one when you want the plain store with no coupling, the meta one for the full domain.

## ✨ Features

- **Reactive State**: Built with [@tanstack/store](https://tanstack.com/store) for efficient state management and UI reactivity.
- **Hook-based Extensibility**: Leverages [before-after-hook](https://github.com/gr2m/before-after-hook) to allow for intercepting and extending identity operations.
- **W3C DID Support**: Built-in support for W3C DID Documents and DID:key generation, including the X25519 `keyAgreement` twin of an Ed25519 key.
- **Standalone by Design**: The mutations are pure, exported functions over a `Store<IdentityStoreState>`, making it usable without any Provider.
- **First-class Provider Support**: The `WithIdentities` extension mounts the same functions on a Wallet Provider.

## 🧱 Core Components

- [**`Identity`**](./src/types.ts): The base interface for an identity, including address, DID, and DID Document. `BaseIdentity` is the minimal contract every store entry satisfies; `IdentityRecord` is the JSON-safe wire twin (no `sign`).
- [**Store functions**](./src/store.ts): `addIdentity`, `removeIdentity`, `getIdentity`, `updateIdentityDidDocument`, `updateIdentityMetadata`, and `clearIdentities` are pure functions over a `Store<IdentityStoreState>` that form the standalone surface of this package.
- [**DID helpers**](./src/did-document.ts): `generateDidKey`, `generateDidDocument`, and `edwardsToX25519PublicKey` are pure functions that require no Provider or store. `generateDidDocument` emits exactly the `Service` entries you pass in (no default service is injected).
- [**`Service`**](./src/types.ts): A DID Core service entry (`id`, `type`, `serviceEndpoint`, plus any service-specific properties).
- [**`WithIdentities`**](./src/extension.ts): The Wallet Provider Extension that adds identity management capabilities.
- [**`IdentityStoreApi`**](./src/types.ts): The API exposed on a provider to manage identities (add, remove, get, clear, update DID document, update metadata).
- [**`IdentitiesNamespace`**](./src/types.ts): The `options.identities` block this package registers on the shared `ExtensionOptions`; bridges augment it with their own fields.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities-core
```

## 🚀 Quick Start

### Standalone: Pure Store Functions

No Provider is needed; create a `Store` and call the exported store functions directly:

```typescript
import { Store } from "@tanstack/store";
import {
  addIdentity,
  getIdentity,
  removeIdentity,
  updateIdentityMetadata,
  type IdentityStoreState,
  type Identity,
} from "@algorandfoundation/identities-core";

const store = new Store<IdentityStoreState<Identity>>({ identities: [] });

// Add an identity
addIdentity({
  store,
  identity: { address: "did:key:z6M...", type: "did:key" },
});

// Read it back
const identity = getIdentity({ store, address: "did:key:z6M..." });

// Shallow-merge metadata
updateIdentityMetadata({ store, address: "did:key:z6M...", metadata: { label: "Main" } });

// Subscribe to changes
store.subscribe(({ currentVal }) => {
  console.log("Identities:", currentVal.identities);
});

// Remove when done
removeIdentity({ store, address: "did:key:z6M..." });
```

### Standalone: DID helpers

```typescript
import { generateDidKey, generateDidDocument } from "@algorandfoundation/identities-core";

const did = generateDidKey(ed25519PublicKey);
const didDocument = generateDidDocument(
  did,
  ed25519PublicKey,
  [],
  [{ id: `${did}#hub`, type: "DIDCommMessaging", serviceEndpoint: "https://hub.example/inbox" }],
);
```

### With a Provider

The `WithIdentities` extension mounts the same store functions on a Wallet Provider.

#### 1. Adding the Extension to a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

// Define a provider with the store-only identities extension
const MyProvider = Provider.withExtensions([WithIdentities]);

// Initialize the provider
const identityStore = new Store({ identities: [] });
const identityHooks = new Hook.Collection();

const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    identities: {
      store: identityStore,
      hooks: identityHooks,
    },
  },
);
```

#### 2. Managing Identities

```typescript
// Add an identity
await provider.identity.store.addIdentity({
  address: "did:key:z6M...",
  type: "did:key",
});

// Record metadata (shallow-merged into identity.metadata)
await provider.identity.store.updateIdentityMetadata("did:key:z6M...", { label: "Main" });

// Access identities (reactive)
console.log(provider.identities);

// Subscribe to changes via the store
identityStore.subscribe(({ currentVal }) => {
  console.log("Updated identities:", currentVal.identities);
});
```

#### 3. Using Hooks

Every `identity.store` method is routed through the hook collection under its operation id: `add`, `remove`, `get`, `clear`, `updateDidDocument`, `updateMetadata`.

```typescript
provider.identity.store.hooks.before("add", (options) => {
  console.log("Adding identity:", options.identity.address);
});
```

## ⚙️ Configuration

`WithIdentities` reads the `options.identities` block (`IdentitiesNamespace`). Every field is optional; a fresh in-memory store and hook collection are created when omitted.

| Option                             | Type                        | Added by                                                 | Description                                                                                            |
| ---------------------------------- | --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `identities.store`                 | `Store<IdentityStoreState>` | `identities-core`                                        | The reactive store backing the identity state. Share the same instance with every bridge.              |
| `identities.hooks`                 | `HookCollection`            | `identities-core`                                        | Hook collection every `identity.store` method is routed through.                                       |
| `identities.keystore.autoPopulate` | `boolean` (default `true`)  | [`identities-keystore-extension`](../keystore-extension) | Populate the identity store from identity-context keys in the keystore and keep DID documents in sync. |

The connections bridge ([`identities-connections-extension`](../connections-extension)) reads `identities.store` and adds no fields; the intermezzo bridge ([`identities-intermezzo-extension`](../intermezzo-extension)) reads `options.intermezzo` instead.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/core/).

## 📜 License

Apache-2.0
