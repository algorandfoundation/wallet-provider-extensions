# 🎫 @algorandfoundation/credentials-intermezzo-extension

Intermezzo OID4VC issuer/verifier bridge for the credentials domain.

Wires an [intermezzo](https://github.com/algorandfoundation/intermezzo) backend into the credential store: credential offers, presentation requests, session mirroring, offer redemption (OID4VCI pre-authorized code flow) and presentation responses (OID4VP `direct_post`). The HTTP transport lives in [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js).

> 💡 This bridge is an **opt-in install** — the [`@algorandfoundation/credentials`](../meta) meta-package is deliberately backend-agnostic and does not include it.

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
import { WithIdentityStore } from "@algorandfoundation/identities-store";
import { WithCredentials } from "@algorandfoundation/credentials";
import { WithIntermezzoCredentials } from "@algorandfoundation/credentials-intermezzo-extension";

// Mount order matters: identities → credentials → intermezzo bridge.
const MyProvider = Provider.withExtensions([
  WithIdentityStore,
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
```

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/credentials/intermezzo-extension/).

## 📜 License

Apache-2.0
