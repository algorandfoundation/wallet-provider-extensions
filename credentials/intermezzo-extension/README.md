# 🎫 @algorandfoundation/credentials-intermezzo-extension

Intermezzo OID4VC issuer/verifier bridge for the credentials domain.

Wires an [intermezzo](https://github.com/algorandfoundation/intermezzo) backend into the credential store: credential offers, presentation requests, session mirroring, offer redemption (OID4VCI pre-authorized code flow) and presentation responses (OID4VP `direct_post`). The HTTP transport lives in [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js), whose `IntermezzoClient` / `IntermezzoCredentialsClient` are re-exported here and run standalone; the `WithIntermezzoCredentials` extension is the first-class Provider wrapper over them (see [Standalone Usage](#-standalone-usage)).

> 💡 This bridge is an **opt-in install**, as the [`@algorandfoundation/credentials`](../meta) meta-package is deliberately backend-agnostic and does not include it.

## ✨ Features

- **`provider.credential.intermezzo`**: holder-side API scoped by `identityAddress` (`createOffer`, `redeemOfferUri`, `createPresentationRequest`, `respondToPresentationRequest`, session refresh helpers).
- **Session mirroring**: remote issuance/verification sessions are upserted into the local credential store so the UI drives everything from a single tanstack store; optional polling via `pollIntervalMs`.
- **Shared client**: pass a pre-built `IntermezzoClient` via `options.intermezzo.client` to share connection state with [`@algorandfoundation/identities-intermezzo-extension`](../../identities/intermezzo-extension).

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-intermezzo-extension
```

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithCredentials } from "@algorandfoundation/credentials";
import { WithIntermezzoCredentials } from "@algorandfoundation/credentials-intermezzo-extension";

// Mount order matters: identities → credentials → intermezzo bridge.
const MyProvider = Provider.withExtensions([
  WithIdentities,
  WithCredentials,
  WithIntermezzoCredentials,
]);

const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    intermezzo: {
      baseUrl: "https://api.example.com",
      getAuthToken: () => getManagerJwt(),
      pollIntervalMs: 5_000,
    },
  },
);

// Redeem a scanned credential offer for an identity
const { credential } = await provider.credential.intermezzo.redeemOfferUri({
  identityAddress: "did:key:z6Mk...",
  offerUri: "openid-credential-offer://...",
});

// Reactive getters stay live: the bridge returns only `{ credential }`.
provider.credentials; // includes the redeemed credential
```

## ⚙️ Configuration

This bridge owns the `options.intermezzo` namespace (`IntermezzoNamespace`, registered on `ExtensionOptions` by this package and shared with [`@algorandfoundation/identities-intermezzo-extension`](../../identities/intermezzo-extension), which augments it). It reads nothing from `options.credentials`: the mounted `provider.credential.store` is its source of truth.

| Field                       | Type                      | Default                                   | Description                                                                                           |
| --------------------------- | ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `intermezzo.baseUrl`        | `string`                  | — (**required** unless `client` is given) | Base URL of the intermezzo host (see `IntermezzoClientConfig`).                                       |
| `intermezzo.getAuthToken`   | `() => string \| Promise` | —                                         | Manager JWT supplier forwarded to the client (see `IntermezzoClientConfig`).                          |
| `intermezzo.client`         | `IntermezzoClient`        | new client                                | Pre-built shared client; reuses connection state across the credentials and identities bridges.       |
| `intermezzo.pollIntervalMs` | `number`                  | off                                       | When > 0, polls issuer/verifier sessions on this interval and mirrors them into the credential store. |

## 🧱 Standalone Usage

The mounted surface of this package (`provider.credential.intermezzo`) is by design a Provider extension, existing to mirror remote sessions into the mounted credential store. The building blocks underneath it are fully usable without a Provider:

- **HTTP transport**: the re-exported `IntermezzoClient` / `IntermezzoCredentialsClient` from [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js) talk to the intermezzo backend directly (offers, presentation requests, session polling).
- **Credential store & OID4VC primitives**: the standalone `createCredentialStore` engine and the OID4VCI/OID4VP utilities (`parseCredentialOfferUrl`, `exchangePreAuthorizedCode`, `requestCredential`, `buildVpTokenJwt`, …) live in [`@algorandfoundation/credentials-core`](../core/README.md) and need no Provider; see its README for the standalone flow.

```typescript
import { IntermezzoClient } from "@algorandfoundation/credentials-intermezzo-extension";

const client = new IntermezzoClient({
  baseUrl: "https://api.example.com",
  getAuthToken: () => getManagerJwt(),
});
```

This package adds no standalone engine of its own; what it contributes is exactly the Provider bridge between those primitives.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/intermezzo-extension/).

## 📜 License

Apache-2.0
