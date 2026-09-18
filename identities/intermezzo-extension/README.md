# 🆔 @algorandfoundation/identities-intermezzo-extension

Intermezzo identity-anchoring bridge for the identities domain.

Wires an [intermezzo](https://github.com/algorandfoundation/intermezzo) backend onto the identities extension surface at `provider.identity.intermezzo`: manager identity endpoints, the credential-gated `did:algo` contract deployment (`anchorIdentity`) and DID-document update flows, plus an algokit-utils Algorand signer derived from an identity's `did:key`. The HTTP transport lives in [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js). The signer helpers and the client work standalone (no Provider required; see [Standalone Usage](#-standalone-usage)), while `WithIntermezzoIdentities` mounts the full flow on a Wallet Provider.

## ✨ Features

- **`anchorIdentity`**: end-to-end "anchor on chain" upgrade path: it builds the `did:algo` create-app atomic group (gated by a device-attestation SD-JWT VC presentation), Ed25519-signs the wallet-owned positions with the identity's key, submits, and records the anchor snapshot in the identity's metadata through `provider.identity.store.updateIdentityMetadata` (so it runs through the store's `updateMetadata` hook and reaches every subscriber of the shared store).
- **Holder DID transactions**: `buildUserContractCreate` / `submitUserContractCreate` / `buildUserDidDocumentUpdate` / `submitUserDidDocumentUpdate`, all forwarding the compact SD-JWT VC presentation as the `x-credential-presentation` header.
- **`getAlgorandSigner`**: adapts a `did:key`-backed identity into an algokit-utils `AddressWithSigners` (canonical Algorand address + `TransactionSigner`).
- **Shared client**: pass a pre-built `IntermezzoClient` via `options.intermezzo.client` to share connection state with [`@algorandfoundation/credentials-intermezzo-extension`](../../credentials/intermezzo-extension).
- **One `options.intermezzo` block**: the bridge reads the `IntermezzoNamespace` registered by `@algorandfoundation/credentials-intermezzo-extension`, so a composition root configures the intermezzo host once for both bridges.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities-intermezzo-extension
```

## 🚀 Quick Start

### With a Provider

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities";
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
    credentials: { store: credentialsStore, hooks: credentialHooks },
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

// The anchor snapshot now lives in the identity's metadata
const anchored = await provider.identity.store.getIdentity("did:key:z6Mk...");
console.log(anchored?.metadata?.anchor); // { didAlgo, didDocument, anchoredAt, ... }
```

## 🧰 Standalone Usage

The signing helpers are pure, exported functions that take an `Identity` (any identity carrying a `did:key` and a `sign` callback, e.g. one populated by the identities-keystore bridge) and need no Provider:

```typescript
import {
  createIdentityAlgorandSigner,
  signGroupForIdentity,
} from "@algorandfoundation/identities-intermezzo-extension";

// Adapt a did:key-backed identity into an algokit-utils AddressWithSigners
const { sendingAddress, signer } = createIdentityAlgorandSigner(identity);

// Or sign the wallet-owned positions of an unsigned atomic group directly
const signedPositions = await signGroupForIdentity(unsignedGroup, identity);
```

The HTTP transport is likewise Provider-free; you can build an `IntermezzoClient` and call the endpoints yourself (import it from [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js); this package re-exports it for existing consumers):

```typescript
import { IntermezzoClient } from "@algorandfoundation/intermezzo-client";

const client = new IntermezzoClient({
  baseUrl: "https://api.example.com",
  getAuthToken: () => getManagerJwt(),
});
```

The `anchorIdentity` orchestration itself is Provider-bound (it composes the identities extension surface), but every step it performs (build via the client, sign via `signGroupForIdentity`, and submit via the client) is available standalone. The underlying identities domain is also fully standalone via pure store functions; see the [identities-core README](../core/README.md).

## ⚙️ Configuration

The bridge reads the `options.intermezzo` block (`IntermezzoNamespace`, registered on the shared `ExtensionOptions` by [`@algorandfoundation/credentials-intermezzo-extension`](../../credentials/intermezzo-extension)); it adds no fields of its own and takes no `options.identities` input, since it reaches the identity store through `provider.identity.store`.

| Option                      | Type                                                        | Required                    | Description                                                                                                                   |
| --------------------------- | ----------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `intermezzo.baseUrl`        | `string`                                                    | yes, unless `client` is set | Base URL of the intermezzo host.                                                                                              |
| `intermezzo.basePath`       | `string` (default `/v1`)                                    | no                          | Path prefix prepended to every route; pass `""` to disable.                                                                   |
| `intermezzo.getAuthToken`   | `() => string \| Promise<string \| undefined> \| undefined` | no                          | Supplies the manager JWT sent as the bearer token, called per request.                                                        |
| `intermezzo.fetch`          | `typeof fetch`                                              | no                          | Custom `fetch` implementation (defaults to the global `fetch`).                                                               |
| `intermezzo.defaultHeaders` | `Record<string, string>`                                    | no                          | Extra headers merged into every request.                                                                                      |
| `intermezzo.client`         | `IntermezzoClient`                                          | no                          | Pre-built client reused instead of constructing one; share it with `WithIntermezzoCredentials` to pool auth/connection state. |
| `intermezzo.pollIntervalMs` | `number`                                                    | no                          | Read by `WithIntermezzoCredentials` only (session mirroring); ignored by this bridge.                                         |

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/identities/intermezzo-extension/).

## 📜 License

Apache-2.0
