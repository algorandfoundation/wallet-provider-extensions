# 🔑 @algorandfoundation/passkeys

Meta package for the passkeys domain.

This package owns the unified `WithPasskeys` extension: it composes the core store ([`@algorandfoundation/passkeys-core`](../core)) with the connections bridge ([`@algorandfoundation/passkeys-connections-extension`](../connections-extension), an optional peer loaded lazily to mount the session-scoped remote mirror at `provider.passkey.remote`). A missing bridge peer degrades silently to a local-only passkeys surface.

The passkeys core is platform-neutral, so this package ships a single entry; the React Native feeder lives in [`@algorandfoundation/react-native-passkeys`](../react-native) and composes the same core.

## 📥 Installation

```bash
pnpm add @algorandfoundation/passkeys
```

`@tanstack/store` and `before-after-hook` are required peer dependencies. Install `@algorandfoundation/passkeys-connections-extension` too when the wallet exchanges passkey metadata over connections; it is an **optional** peer the unified extension loads lazily.

## 🚀 Quick Start

### With a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithPasskeys } from "@algorandfoundation/passkeys";

const MyProvider = Provider.withExtensions([WithPasskeys]);

const provider = new MyProvider({ id: "my-wallet", name: "My Wallet" }, {});
await provider.passkey.store.addPasskey({ credentialId: "abc" });
// once the connections bridge resolves (optional peer):
await provider.passkey.store.ready;
provider.passkey.remote?.expose();
```

### Standalone

Everything from `@algorandfoundation/passkeys-core` is re-exported, so the pure store functions and reconcile helpers run without a Provider:

```typescript
import { Store } from "@tanstack/store";
import { addPasskey, reconcilePasskeys, type PasskeysState } from "@algorandfoundation/passkeys";

const store = new Store<PasskeysState>({ passkeys: [] });
addPasskey({ store, passkey: { credentialId: "abc", rpId: "example.com" } });
const { strays } = reconcilePasskeys(store.state.passkeys, serverOptions);
```

## ⚙️ Configuration

The unified `WithPasskeys` reads the shared `options.passkeys` namespace (`PasskeysNamespace`, registered on the `ExtensionOptions` registry by `@algorandfoundation/passkeys-core`); `PasskeysMetaOptions` is that same `PasskeysOptions` shape and the lazily loaded connections bridge takes no options of its own. Other installed passkeys packages augment the same block:

| Option                           | Type                        | Default              | Registered by                                     | Description                                                                               |
| -------------------------------- | --------------------------- | -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `passkeys.store`                 | `Store<PasskeysState>`      | fresh empty store    | `@algorandfoundation/passkeys-core`               | The reactive store, shared with the connections mirror and any other feeder.              |
| `passkeys.hooks`                 | `HookCollection<any>`       | fresh collection     | `@algorandfoundation/passkeys-core`               | `before-after-hook` collection wrapping the store API.                                    |
| `passkeys.log`                   | `LogStoreApi`               | `provider.log`       | `@algorandfoundation/passkeys-core`               | Logger override for reconcile reports.                                                    |
| `passkeys.keystore.autoPopulate` | `boolean`                   | `true`               | `@algorandfoundation/passkeys-keystore-extension` | Only when `WithPasskeysKeystore` is mounted alongside.                                    |
| `passkeys.module`                | `PasskeyAutofillModuleLike` | lazily resolved peer | `@algorandfoundation/react-native-passkeys`       | Only with the React Native package, whose own `WithPasskeys` replaces this one on mobile. |

## 📄 License

Apache-2.0
