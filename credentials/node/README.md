# 🎫 @algorandfoundation/credentials-node

Node.js / server credentials implementation, which is usable standalone or as an Algorand Provider extension.

Both usage modes are first-class. **Standalone**: the package re-exports the full [`@algorandfoundation/credentials-core`](../core) surface (the `createCredentialStore` engine, holder-binding seam, OID4VC/SD-JWT/`did:key` utilities) plus the node `nodeDigitalCredentials` platform object, all of which run without a Provider (see [Standalone Usage](#-standalone-usage)). **Provider integration**: it exports the node `WithCredentials` extension, which is the same engine wired to an injected key/value persistence driver (a file or database wrapper adapts in two lines; in-memory when omitted). It is the server counterpart of [`@algorandfoundation/credentials-web`](../web) and [`@algorandfoundation/react-native-credentials`](../react-native), exactly like [`@algorandfoundation/keystore-node`](../../keystore/node) is for the keystore.

> ⚠️ Node has no user-agent credential chooser, so `provider.credential.digital` (`nodeDigitalCredentials`) is a **permanent explicit `unsupported`** implementation of the W3C Digital Credentials API contract: `isSupported()` returns `false` and `get`/`create` reject with `DigitalCredentialsUnsupportedError`; it is never a silent no-op. Server-side wallets drive OID4VCI/OID4VP directly through the core utilities instead.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-node
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead, as its `node`/default export condition resolves to this package.

## 🚀 Quick Start (Provider integration)

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithCredentials } from "@algorandfoundation/credentials-node";

// Identities are optional: when mounted first, WithCredentials auto-binds
// identityHolderBinding(provider.identity.store) for signer resolution and
// cascade eviction. Without it the credential store still works.
const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    // Persist through any string key/value store (a JSON file, SQLite, Redis, ...).
    credentials: { driver: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) } },
  },
);

// Hydration (and the optional connections bridge) has settled.
await provider.credential.store.ready;
await provider.credential.store.getCredentials();
```

## ⚙️ Configuration

Everything under `options.credentials` is optional. The block is the shared `CredentialsNamespace` from [`@algorandfoundation/credentials-core`](../core); node adds no platform seam of its own.

| Field                    | Type                          | Default                                                   | Description                                                                               |
| ------------------------ | ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `credentials.store`      | `Store<CredentialStoreState>` | new empty store                                           | Reactive TanStack store backing the engine; share it to subscribe from application code.  |
| `credentials.hooks`      | `HookCollection`              | new collection                                            | `before-after-hook` collection guarding every store operation (exposed as `store.hooks`). |
| `credentials.driver`     | `CredentialKeyValueStore`     | `memoryCredentialDriver()`                                | String key/value persistence seam for the durable `credentials` slice.                    |
| `credentials.binding`    | `HolderBinding`               | `identityHolderBinding(provider.identity.store)` if found | Signer resolution + removal cascade for credential holders.                               |
| `credentials.storageKey` | `string`                      | `DEFAULT_CREDENTIALS_KEY`                                 | Key under which the snapshot is serialized in the driver.                                 |

## 🧱 Standalone Usage

No Provider is required; simply build the core engine with your own driver:

```typescript
import {
  createCredentialStore,
  nodeDigitalCredentials,
} from "@algorandfoundation/credentials-node";

const { api, store, ready } = createCredentialStore({
  driver: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) },
});
await ready;

const credentials = await api.getCredentials();

// Explicit, never silent: node has no Digital Credentials user agent.
nodeDigitalCredentials.isSupported(); // false
```

The `WithCredentials` extension builds exactly this engine (and attaches `nodeDigitalCredentials` at `provider.credential.digital`), so the two modes stay interchangeable. See the [core README](../core/README.md) for the full engine and OID4VC utility surface.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/node/).

## 📜 License

Apache-2.0
