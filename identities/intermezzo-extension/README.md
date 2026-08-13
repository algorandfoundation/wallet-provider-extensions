# 🆔 @algorandfoundation/identities-intermezzo-extension

Intermezzo identity-anchoring bridge for the identities domain.

Wires an [intermezzo](https://github.com/algorandfoundation/intermezzo) backend onto the identities extension surface at `provider.identity.intermezzo`: manager identity endpoints, the credential-gated `did:algo` contract deployment (`anchorIdentity`) and DID-document update flows, plus an algokit-utils Algorand signer derived from an identity's `did:key`. The HTTP transport lives in [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js).

## ✨ Features

- **`anchorIdentity`**: end-to-end "anchor on chain" upgrade path — builds the `did:algo` create-app atomic group (gated by a device-attestation SD-JWT VC presentation), Ed25519-signs the wallet-owned positions with the identity's key, submits, and records the anchor snapshot in the identity's metadata.
- **Holder DID transactions**: `buildUserContractCreate` / `submitUserContractCreate` / `buildUserDidDocumentUpdate` / `submitUserDidDocumentUpdate`, all forwarding the compact SD-JWT VC presentation as the `x-credential-presentation` header.
- **`getAlgorandSigner`**: adapts a `did:key`-backed identity into an algokit-utils `AddressWithSigners` (canonical Algorand address + `TransactionSigner`).
- **Shared client**: pass a pre-built `IntermezzoClient` via `options.intermezzo.client` to share connection state with [`@algorandfoundation/credentials-intermezzo-extension`](../../credentials/intermezzo-extension).

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities-intermezzo-extension
```

## 🚀 Quick Start

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-extension";
import { WithCredentials } from "@algorandfoundation/credentials";
import { WithIntermezzoCredentials } from "@algorandfoundation/credentials-intermezzo-extension";
import { WithIntermezzoIdentities } from "@algorandfoundation/identities-intermezzo-extension";

// Mount order matters: identities → credentials → intermezzo bridges.
const MyProvider = Provider.withExtensions([
  WithIdentities,
  WithCredentials,
  WithIntermezzoCredentials,
  WithIntermezzoIdentities,
]);

const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    identities: { store: identitiesStore },
    intermezzo: {
      baseUrl: "https://api.example.com",
      getAuthToken: () => getManagerJwt(),
    },
  },
);

// Anchor a did:key identity on chain as a did:algo contract
const { submitResponse } = await provider.identity.intermezzo.anchorIdentity({
  identityAddress: "did:key:z6Mk...",
  credentialPresentation: compactSdJwtPresentation,
});
```

> 💡 Pass the identities extension's reactive store via `options.identities.store` so `anchorIdentity` can record the anchor snapshot in the identity's metadata.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/intermezzo-extension/).

## 📜 License

Apache-2.0
