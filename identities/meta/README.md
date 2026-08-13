# 🪪 @algorandfoundation/identities

Meta package that resolves to the right platform identities implementation.

One install covers the identities domain: the `exports` map uses runtime/bundler conditions, exactly like [`@algorandfoundation/keystore`](../../keystore/meta) and [`@algorandfoundation/credentials`](../../credentials/meta):

| Condition              | Resolves to                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `react-native` (Metro) | platform-neutral composition (store + unified `WithIdentities`) |
| `browser`              | platform-neutral composition (store + unified `WithIdentities`) |
| `node` / default       | platform-neutral composition (store + unified `WithIdentities`) |

Today all conditions resolve to the same composition — [`@algorandfoundation/identities-store`](../store) (reactive identity store, DID-document helpers) plus [`@algorandfoundation/identities-extension`](../extension) (the unified `WithIdentities` extension with its keystore bridge). Per-platform identities packages (e.g. an mDoc-backed identity source via the Digital Credentials API) will slot into the corresponding conditions later without any application-facing change.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities
```

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities";

const MyProvider = Provider.withExtensions([WithIdentities]);
const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});

await provider.identity.store.getIdentity("did:key:z6Mk...");
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/meta/).

## 📜 License

Apache-2.0
