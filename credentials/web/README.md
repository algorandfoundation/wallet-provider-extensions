# 🎫 @algorandfoundation/credentials-web

Browser credentials implementation for Algorand Providers.

Re-exports the full [`@algorandfoundation/credentials-core`](../core) surface (the `createCredentialStore` engine, holder-binding seam, OID4VC/SD-JWT/`did:key` utilities) and exports the browser `WithCredentials` extension — the engine wired to a `localStorage` persistence driver by default (`localStorageCredentialDriver`) — alongside the browser seam for the **W3C Digital Credentials API**.

> ⚠️ The Digital Credentials seam is currently an **explicit `unsupported` stub**: `webDigitalCredentials.isSupported()` returns `false` and `get`/`create` reject with `DigitalCredentialsUnsupportedError`. The real `navigator.credentials.get({ digital })` implementation will replace the stub without changing the surface.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-web
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead — its `browser` export condition resolves to this package.

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentityStore } from "@algorandfoundation/identities-store";
import { WithCredentials } from "@algorandfoundation/credentials-web";

const MyProvider = Provider.withExtensions([WithIdentityStore, WithCredentials]);
const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});

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

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/web/).

## 📜 License

Apache-2.0
