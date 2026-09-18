# 🪪 @algorandfoundation/identities

Meta package that owns the composed `WithIdentities` extension and resolves to the right platform identities implementation.

One install covers the identities domain: the `exports` map uses runtime/bundler conditions, exactly like [`@algorandfoundation/keystore`](../../keystore/meta), [`@algorandfoundation/accounts`](../../accounts/meta), and [`@algorandfoundation/credentials`](../../credentials/meta):

| Condition              | Resolves to                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `react-native` (Metro) | platform-neutral composition (core store + composed `WithIdentities`) |
| `browser`              | platform-neutral composition (core store + composed `WithIdentities`) |
| `node` / default       | platform-neutral composition (core store + composed `WithIdentities`) |

## Core = store only, meta = core + bridges

Both [`@algorandfoundation/identities-core`](../core) and this package export a `WithIdentities` extension (the same pattern as `accounts-core` / `accounts`):

| Package                                 | `WithIdentities` mounts                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@algorandfoundation/identities-core`   | The identity store only: `provider.identities` + `provider.identity.store`.                                                                                                                                                                                                                                                                                                                                                                                            |
| `@algorandfoundation/identities` (this) | The core store **plus** the bridges: the keystore bridge ([`identities-keystore-extension`](../keystore-extension), loaded lazily when `provider.key.store` exists) adding `restoreFromDidDocument`, and the connections bridge ([`identities-connections-extension`](../connections-extension), loaded lazily) mounting `provider.identity.remote`. `provider.identity.store.ready` resolves once both have settled; missing peers degrade to the store-only surface. |

Both read the same `options.identities` block, so switching between them is a one-line import change. Everything core exports is re-exported here, so both usage modes come with the one install: the identities domain runs fully **standalone** as pure store functions and DID helpers over [@tanstack/store](https://tanstack.com/store), and ships first-class Provider support via `WithIdentities`. Per-platform identities packages (e.g. an mDoc-backed identity source via the Digital Credentials API) will slot into the corresponding conditions later without any application-facing change.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities
```

## 🚀 Quick Start

### Standalone: Pure Store Functions

```typescript
import { Store } from "@tanstack/store";
import {
  addIdentity,
  updateIdentityMetadata,
  type IdentityStoreState,
  type Identity,
} from "@algorandfoundation/identities";

const store = new Store<IdentityStoreState<Identity>>({ identities: [] });

addIdentity({
  store,
  identity: { address: "did:key:z6Mk...", type: "did:key" },
});
updateIdentityMetadata({ store, address: "did:key:z6Mk...", metadata: { label: "Main" } });
```

### With a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import { WithIdentities } from "@algorandfoundation/identities";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

const identityStore = new Store({ identities: [] });

const MyProvider = Provider.withExtensions([WithKeyStore, WithIdentities]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    keystore: { store: keyStore, hooks: new Hook.Collection() },
    identities: { store: identityStore, keystore: { autoPopulate: true } },
  },
);

// Wait for the lazily loaded bridges before connecting or restoring
await provider.identity.store.ready;

await provider.identity.store.getIdentity("did:key:z6Mk...");
await provider.identity.store.restoreFromDidDocument(backupDocument); // keystore bridge
provider.identity.remote?.expose(); // connections bridge
```

See the [identities-core README](../core/README.md) for the full store-function surface, DID helpers, and hooks.

## ⚙️ Configuration

`WithIdentities` reads the shared options registry; every field is optional (a fresh in-memory store is created when `identities.store` is omitted).

| Option                             | Type                        | Added by                                                 | Description                                                                                                         |
| ---------------------------------- | --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `identities.store`                 | `Store<IdentityStoreState>` | `identities-core`                                        | The reactive identity store; shared with every bridge this extension loads.                                         |
| `identities.hooks`                 | `HookCollection`            | `identities-core`                                        | Hook collection every `identity.store` method is routed through.                                                    |
| `identities.keystore.autoPopulate` | `boolean` (default `true`)  | [`identities-keystore-extension`](../keystore-extension) | Mirror identity-context keystore keys into identities. Only read when the provider carries a keystore.              |
| `keystore.store`                   | `Store<KeyStoreState>`      | `keystore-core`                                          | Forwarded to the keystore bridge when `provider.key.store` exists (the keystore extension owns `options.keystore`). |

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/meta/).

## 📜 License

Apache-2.0
