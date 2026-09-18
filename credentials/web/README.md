# 🎫 @algorandfoundation/credentials-web

Browser credentials implementation, which is usable standalone or as an Algorand Provider extension.

Both usage modes are first-class. **Standalone**: the package re-exports the full [`@algorandfoundation/credentials-core`](../core) surface (the `createCredentialStore` engine, holder-binding seam, OID4VC/SD-JWT/`did:key` utilities) plus the browser pieces, specifically `localStorageCredentialDriver` and the `webDigitalCredentials` platform object, all of which run without a Provider (see [Standalone Usage](#-standalone-usage)). **Provider integration**: it exports the browser `WithCredentials` extension, which is the same engine wired to the `localStorage` persistence driver by default, alongside the browser implementation of the **W3C Digital Credentials API**.

> ⚠️ The Digital Credentials API is **experimental**. `webDigitalCredentials` feature-detects the browser API (the `DigitalCredential` interface object) and forwards requests to `navigator.credentials.get({ digital: { requests } })` / `.create(...)`. Presentation (`get`) is shipping in Chrome/Edge 141+ and Safari on iOS/macOS 26; issuance (`create`) is still behind flags in most user agents. On browsers without the API, `isSupported()` returns `false` and both calls reject with `DigitalCredentialsUnsupportedError`; it is never a silent no-op.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-web
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead, as its `browser` export condition resolves to this package.

## 🚀 Quick Start (Provider integration)

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithCredentials } from "@algorandfoundation/credentials-web";

const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});

// Platform-neutral credential store (hydrated from localStorage by default)
await provider.credential.store.ready;
await provider.credential.store.getCredentials();

// Digital Credentials API seam (feature-detect before calling)
if (provider.credential.digital.isSupported()) {
  const response = await provider.credential.digital.get({
    requests: [{ protocol: "openid4vp-v1-unsigned", data: authorizationRequest }],
  });
}
```

## ⚙️ Configuration

Everything under `options.credentials` is optional. The block is the shared `CredentialsNamespace` from [`@algorandfoundation/credentials-core`](../core); the browser package adds no platform seam of its own, it only changes the default driver.

| Field                    | Type                          | Default                                                     | Description                                                                                 |
| ------------------------ | ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `credentials.store`      | `Store<CredentialStoreState>` | new empty store                                             | Reactive TanStack store backing the engine.                                                 |
| `credentials.hooks`      | `HookCollection`              | new collection                                              | `before-after-hook` collection guarding every store operation.                              |
| `credentials.driver`     | `CredentialKeyValueStore`     | `localStorageCredentialDriver()` (in-memory if unavailable) | String key/value persistence seam; pass `localStorageCredentialDriver(sessionStorage)` etc. |
| `credentials.binding`    | `HolderBinding`               | `identityHolderBinding(provider.identity.store)` when found | Signer resolution + removal cascade for credential holders.                                 |
| `credentials.storageKey` | `string`                      | `DEFAULT_CREDENTIALS_KEY`                                   | `localStorage` key under which the snapshot is serialized.                                  |

## 🧱 Standalone Usage

No Provider is required; simply build the core engine with this package's browser
driver, and use the Digital Credentials platform object directly:

```typescript
import {
  createCredentialStore,
  localStorageCredentialDriver,
  webDigitalCredentials,
} from "@algorandfoundation/credentials-web";

const { api, store, ready } = createCredentialStore({
  driver: localStorageCredentialDriver(),
});
await ready;

const credentials = await api.getCredentials();

// The same feature-detected Digital Credentials seam, sans Provider.
if (webDigitalCredentials.isSupported()) {
  const response = await webDigitalCredentials.get({
    requests: [{ protocol: "openid4vp-v1-unsigned", data: authorizationRequest }],
  });
}
```

The `WithCredentials` extension builds exactly this engine (and attaches
`webDigitalCredentials` at `provider.credential.digital`), so the two modes stay
interchangeable. See the [core README](../core/README.md) for the full engine
and OID4VC utility surface.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/web/).

## 📜 License

Apache-2.0
