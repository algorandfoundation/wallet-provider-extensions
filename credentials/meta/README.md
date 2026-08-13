# 🎫 @algorandfoundation/credentials

Meta package that resolves to the right platform credentials implementation.

One install covers the credentials domain: the `exports` map uses runtime/bundler conditions to select the platform package, exactly like [`@algorandfoundation/keystore`](../../keystore/meta):

| Condition              | Resolves to                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `react-native` (Metro) | [`@algorandfoundation/react-native-credentials`](../react-native)                                                                |
| `browser`              | [`@algorandfoundation/credentials-web`](../web)                                                                                  |
| `node` / default       | [`@algorandfoundation/credentials-core`](../core) surface + node `WithCredentials` + node `unsupported` Digital Credentials stub |

Every condition re-exports the full [`@algorandfoundation/credentials-core`](../core) surface — the `createCredentialStore` engine, the holder-binding seam, the OID4VC/SD-JWT/`did:key` utilities and the Digital Credentials platform contract — and exports the platform's `WithCredentials` extension (built on the engine with a platform persistence driver) plus its `DigitalCredentialsPlatform` implementation (currently explicit `unsupported` stubs everywhere).

> 💡 The meta package is **backend-agnostic**: bridges to concrete issuance/verification backends (e.g. [`@algorandfoundation/credentials-intermezzo-extension`](../intermezzo-extension)) are separate opt-in installs.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials
```

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentityStore } from "@algorandfoundation/identities-store";
import { WithCredentials } from "@algorandfoundation/credentials";

// Identities are optional: when mounted first, WithCredentials auto-binds
// identityHolderBinding(provider.identity.store) for signer resolution and
// cascade eviction. Without it the credential store still works.
const MyProvider = Provider.withExtensions([WithIdentityStore, WithCredentials]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    // Persist through any string key/value store (MMKV, localStorage, ...).
    credentials: { driver: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) } },
  },
);

await provider.credential.store.getCredentials();
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/meta/).

## 📜 License

Apache-2.0
