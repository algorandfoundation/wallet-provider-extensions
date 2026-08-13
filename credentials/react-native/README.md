# 🎫 @algorandfoundation/react-native-credentials

React Native credentials implementation for Algorand Providers.

Re-exports the full [`@algorandfoundation/credentials-core`](../core) surface (the `createCredentialStore` engine, holder-binding seam, OID4VC/SD-JWT/`did:key` utilities) and exports the React Native `WithCredentials` extension — the engine wired to an app-injected key/value persistence driver (MMKV/AsyncStorage adapt in two lines) — alongside the React Native seam for the **W3C Digital Credentials API**.

> ⚠️ The Digital Credentials seam is currently an **explicit `unsupported` stub**: `reactNativeDigitalCredentials.isSupported()` returns `false` and `get`/`create` reject with `DigitalCredentialsUnsupportedError`. The Android Credential Manager / iOS backed implementation will replace the stub without changing the surface.

## 📥 Installation

```bash
pnpm add @algorandfoundation/react-native-credentials
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead — its `react-native` export condition (honored by Metro) resolves to this package.

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentityStore } from "@algorandfoundation/identities-store";
import { WithCredentials } from "@algorandfoundation/react-native-credentials";

const MyProvider = Provider.withExtensions([WithIdentityStore, WithCredentials]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    // Persist through any string key/value store (e.g. MMKV).
    credentials: { driver: { get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) } },
  },
);

// Platform-neutral credential store
await provider.credential.store.getCredentials();

// Digital Credentials API seam (feature-detect before calling)
if (provider.credential.digital.isSupported()) {
  const response = await provider.credential.digital.get({
    requests: [{ protocol: "openid4vp-v1-unsigned", data: authorizationRequest }],
  });
}
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/react-native/).

## 📜 License

Apache-2.0
