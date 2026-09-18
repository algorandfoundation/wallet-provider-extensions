# 🎫 @algorandfoundation/react-native-credentials

React Native credentials implementation, which is usable standalone or as an Algorand Provider extension.

Both usage modes are first-class. **Standalone**: the package re-exports the full [`@algorandfoundation/credentials-core`](../core) surface (the `createCredentialStore` engine, holder-binding seam, OID4VC/SD-JWT/`did:key` utilities) plus `nativeDigitalCredentialsProvider`, all of which are usable without a Provider (see [Standalone Usage](#-standalone-usage)). **Provider integration**: it exports the React Native `WithCredentials` extension. This uses the same engine wired to an app-injected key/value persistence driver (MMKV/AsyncStorage adapt in two lines) and includes the React Native seam for the **W3C Digital Credentials API**. The package is itself an **expo native module**: it ships the Android Credential Manager registry implementation under `android/` and an explicit "unsupported" iOS stub under `ios/` (see `expo-module.config.json`).

> ⚠️ Of the two Digital Credentials sides, only the **wallet/holder** side is implemented: `provider.credential.digitalProvider` is backed by the [bundled native module](#-digital-credentials-holderprovider-seam) on Android (see below). The **requester** side (`provider.credential.digital` / `reactNativeDigitalCredentials`) is still an **explicit `unsupported` stub**: `isSupported()` returns `false` and `get`/`create` reject with `DigitalCredentialsUnsupportedError`. Both real implementations land without changing the surface.

## 📥 Installation

```bash
pnpm add @algorandfoundation/react-native-credentials
```

> 💡 Most applications should install the [`@algorandfoundation/credentials`](../meta) meta-package instead, as its `react-native` export condition (honored by Metro) resolves to this package.

## 🚀 Quick Start (Provider integration)

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithCredentials } from "@algorandfoundation/react-native-credentials";

const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    // Persist through any string key/value store (e.g. MMKV).
    credentials: { driver: { get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) } },
  },
);

// Platform-neutral credential store (hydrated from the injected driver)
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

Everything under `options.credentials` is optional. The block is the shared `CredentialsNamespace` from [`@algorandfoundation/credentials-core`](../core), which this package **augments** with the `digitalCredentialsModule` seam (a single typed `options.credentials` block, no second `credentials` key).

| Field                                  | Type                           | Default                                                     | Description                                                                                           |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `credentials.store`                    | `Store<CredentialStoreState>`  | new empty store                                             | Reactive TanStack store backing the engine.                                                           |
| `credentials.hooks`                    | `HookCollection`               | new collection                                              | `before-after-hook` collection guarding every store operation.                                        |
| `credentials.driver`                   | `CredentialKeyValueStore`      | `memoryCredentialDriver()`                                  | String key/value persistence seam; inject MMKV/AsyncStorage so credentials survive a restart.         |
| `credentials.binding`                  | `HolderBinding`                | `identityHolderBinding(provider.identity.store)` when found | Signer resolution + removal cascade for credential holders.                                           |
| `credentials.storageKey`               | `string`                       | `DEFAULT_CREDENTIALS_KEY`                                   | Key under which the snapshot is serialized in the driver.                                             |
| `credentials.digitalCredentialsModule` | `DigitalCredentialsModuleLike` | `defaultDigitalCredentialsModule()` or `unsupported`        | Native Digital Credentials module backing `provider.credential.digitalProvider` (also the test seam). |

## 🧱 Standalone Usage

No Provider is required; the core engine composes directly with any string
key/value driver, and the native Digital Credentials holder seam is a plain
factory over the bundled module:

```typescript
import {
  createCredentialStore,
  defaultDigitalCredentialsModule,
  nativeDigitalCredentialsProvider,
} from "@algorandfoundation/react-native-credentials";

const { api, store, ready } = createCredentialStore({
  // Persist through any string key/value store (e.g. MMKV).
  driver: { get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) },
});
await ready;

const credentials = await api.getCredentials();

// Wallet/holder side of the Digital Credentials API, sans Provider.
const module = defaultDigitalCredentialsModule();
if (module) {
  const digital = nativeDigitalCredentialsProvider(module);
  await digital.registerCredentials(entries);
}
```

The `WithCredentials` extension builds exactly this engine (and resolves the
native module for `provider.credential.digitalProvider` the same way), so the
two modes stay interchangeable. See the [core README](../core/README.md) for
the full engine and OID4VC utility surface.

## 🪪 Digital Credentials Holder/Provider Seam

The wallet/holder side of the W3C Digital Credentials API, which involves registering the wallet's credentials with the OS credential registry and answering the presentation requests the platform routes back, is attached at `provider.credential.digitalProvider` as a `DigitalCredentialsProvider` from [`@algorandfoundation/credentials-core`](../core).

### Injectable native module

There is no web API for this side; it is inherently native. The native module ships **inside this package** (`android/`, `ios/`, `expo-module.config.json`), but the provider binding keeps **no compile-time dependency on React Native**: the surface it consumes is the structural `DigitalCredentialsModuleLike` seam (`isSupported`, `registerCredentials`, `unregisterCredentials`, `completePresentationRequest`, `abortPresentationRequest`, `addListener("onPresentationRequest", …)`), following the same pattern the passkeys package uses to bind `react-native-passkey-autofill`. `nativeDigitalCredentialsProvider(module)` builds the provider over it, so the package builds and unit-tests without native code (tests inject doubles).

`WithCredentials` resolves the module in this order:

1. `options.credentials.digitalCredentialsModule`: the explicitly injected module (also the testing seam).
2. `defaultDigitalCredentialsModule()`: a **lazy** `require` of the bundled native module binding (`src/digital/`, an `expo` `requireNativeModule` call), validated by shape. Metro transforms this module to CJS so the lookup works on device; under Node ESM (tests, tooling), or when the native module is not compiled into the app, it degrades to `undefined`.
3. `unsupportedDigitalCredentialsProvider(reason)`: when neither resolves, `isSupported()` returns `false` and register/unregister reject with `DigitalCredentialsUnsupportedError`, never a silent no-op. (`setRequestHandler` is a documented no-op because the contract is synchronous `void`; feature-detect with `isSupported()` before wiring a handler.)

The Android implementation registers entries with the Credential Manager registry (`androidx.credentials.registry`), ships the default OpenID4VP matcher, and fulfills `GET_CREDENTIAL` through its own activity. Being an expo module, it is picked up by expo autolinking when this package is installed in an expo/React Native app (`expo` is an optional peer, only needed on device).

### Wiring example

Register one entry per credential the wallet can present, then install the request handler. `metadata.vct` (the SD-JWT VC type (required; entries without it are skipped)) and `metadata.claims` drive the platform matcher that pre-filters and renders credentials in the OS chooser, while `display.title`/`display.subtitle` label them (`title` falls back to the entry `id`, and each claim's `displayName` to its joined path).

```typescript
const digital = provider.credential.digitalProvider;

if (digital.isSupported()) {
  const credentials = await provider.credential.store.getCredentials();

  await digital.registerCredentials(
    credentials.map((credential) => ({
      id: credential.id,
      protocols: ["openid4vp-v1-unsigned"],
      display: { title: credential.name, subtitle: credential.identityAddress },
      metadata: {
        vct: "https://credentials.example/badge",
        claims: [{ path: ["given_name"], displayName: "Given name" }],
      },
    })),
  );

  // Invoked when the platform routes a presentation request to the wallet.
  // Resolving hands the response back to the verifier; rejecting aborts the
  // platform flow with the error message.
  digital.setRequestHandler(async (request) => {
    // request: { protocol, data, origin?, selectedCredentialId? }
    const data = await buildOpenId4VpResponse(request);
    return { protocol: request.protocol, data };
  });
}
```

Re-register on every credential store change; `registerCredentials` replaces the app's entries wholesale, and `unregisterCredentials()` removes them all (e.g. on wallet lock or sign-out). Calling `setRequestHandler` again swaps the handler without adding a second native subscription.

> 💡 The **requester** side (`provider.credential.digital`, i.e. `reactNativeDigitalCredentials`) is unrelated to this seam and remains an explicit `unsupported` stub; feature-detect it before calling `get`/`create`.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/react-native/).

## 📜 License

Apache-2.0
