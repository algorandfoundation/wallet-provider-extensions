# 🎫 @algorandfoundation/credentials

Meta package that resolves to the right platform credentials implementation.

One install covers the credentials domain: the `exports` map uses runtime/bundler conditions to select the platform package, exactly like [`@algorandfoundation/keystore`](../../keystore/meta):

| Condition              | Resolves to                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `react-native` (Metro) | [`@algorandfoundation/react-native-credentials`](../react-native) |
| `browser`              | [`@algorandfoundation/credentials-web`](../web)                   |
| `node` / default       | [`@algorandfoundation/credentials-node`](../node)                 |

This package contains **no implementation of its own**. Every platform package re-exports the full [`@algorandfoundation/credentials-core`](../core) surface, including the `createCredentialStore` engine, the holder-binding seam, the OID4VC/SD-JWT/`did:key` utilities and the Digital Credentials platform contract, and exports its `WithCredentials` extension (built on the engine with a platform persistence driver) plus its `DigitalCredentialsPlatform` implementation (a real feature-detected one on `browser` via `webDigitalCredentials`; explicit `unsupported` stubs on `react-native` and `node`). Both usage modes are first-class from this one install: run the engine and utilities **standalone** (no Provider required), or mount `WithCredentials` for the Provider/Extensions pattern.

> 💡 The meta package is **backend-agnostic**: bridges to concrete issuance/verification backends (e.g. [`@algorandfoundation/credentials-intermezzo-extension`](../intermezzo-extension)) are separate opt-in installs.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials
```

## 🚀 Quick Start

### Provider integration

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithCredentials } from "@algorandfoundation/credentials";

// Identities are optional: when mounted first, WithCredentials auto-binds
// identityHolderBinding(provider.identity.store) for signer resolution and
// cascade eviction. Without it the credential store still works.
const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    // Persist through any string key/value store (MMKV, localStorage, ...).
    credentials: { driver: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) } },
  },
);

// Hydration (and the optional connections bridge) has settled.
await provider.credential.store.ready;
await provider.credential.store.getCredentials();
```

### Configuration

Everything under `options.credentials` is optional. The block is the shared `CredentialsNamespace` registered on `ExtensionOptions` by [`@algorandfoundation/credentials-core`](../core); platform packages augment it (never register a second `credentials` key), so the fields available depend on the resolved platform.

| Field                                  | Type                           | Default                                                     | Available on   | Description                                                                             |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `credentials.store`                    | `Store<CredentialStoreState>`  | new empty store                                             | all            | Reactive TanStack store backing the engine (also read by `WithCredentialsConnections`). |
| `credentials.hooks`                    | `HookCollection`               | new collection                                              | all            | `before-after-hook` collection guarding every store operation.                          |
| `credentials.driver`                   | `CredentialKeyValueStore`      | `localStorage` (web), in-memory (node, react-native)        | all            | String key/value persistence seam for the durable `credentials` slice.                  |
| `credentials.binding`                  | `HolderBinding`                | `identityHolderBinding(provider.identity.store)` when found | all            | Signer resolution + removal cascade for credential holders.                             |
| `credentials.storageKey`               | `string`                       | `DEFAULT_CREDENTIALS_KEY`                                   | all            | Key under which the snapshot is serialized in the driver.                               |
| `credentials.digitalCredentialsModule` | `DigitalCredentialsModuleLike` | bundled expo module (lazy) or `unsupported`                 | `react-native` | Native Digital Credentials module backing `provider.credential.digitalProvider`.        |

### Standalone (no Provider)

The full core surface is re-exported on every condition, so the engine composes
directly:

```typescript
import { createCredentialStore } from "@algorandfoundation/credentials";

const { api, store, ready } = createCredentialStore({
  // Persist through any string key/value store (MMKV, localStorage, ...).
  driver: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) },
});
await ready;

const credentials = await api.getCredentials();
```

See the [core README](../core/README.md) for the full standalone surface
(holder binding, credential management, OID4VC utilities).

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/meta/).

## 📜 License

Apache-2.0
