---
title: "Hold verifiable credentials"
description: Store, query, and present verifiable credentials bound to your identities.
sidebar:
  order: 7
---

The credentials domain makes your wallet a **holder** of verifiable credentials: it stores them, binds each one to an identity, and drives the issuance and presentation flows (OID4VC, SD-JWT, and the browser's Digital Credentials API). This guide covers the operations; the identity binding it builds on is explained in [Identities](/concepts/identities/).

Like every package in this repo, credentials work standalone, as the `createCredentialStore` engine factory does not require a Provider (see the [credentials-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/credentials/core#readme)), while `WithCredentials` provides first-class Provider integration as used below.

## Set up the extension

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities";
import { WithCredentials } from "@algorandfoundation/credentials";
import type { CredentialStoreState } from "@algorandfoundation/credentials";
import { Store } from "@tanstack/store";

const credentialStore = new Store<CredentialStoreState>({
  credentials: [],
  issuanceSessions: [],
  verificationSessions: [],
});

const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    identities: { store: identityStore },
    credentials: { store: credentialStore },
  },
);
```

The meta package resolves the right platform pieces: `localStorage` persistence and `navigator.credentials` support on the web (`@algorandfoundation/credentials-web`), the Android Credential Manager integration on React Native (`@algorandfoundation/react-native-credentials`), and a file-free in-memory holder for servers, CLIs, and tests on Node.js (`@algorandfoundation/credentials-node`). The `options.credentials` block is one typed namespace (`CredentialsNamespace`: `store`, `hooks`, `driver`, `binding`, `storageKey`) that the platform packages augment, e.g. `credentials.digitalCredentialsModule` on React Native.

## Store a credential

Every credential is bound to a holder identity through `identityAddress`:

```typescript
await provider.credential.store.addCredential({
  id: crypto.randomUUID(),
  type: ["VerifiableCredential", "IdentityCredential"],
  identityAddress: "did:key:z6Mk...", // the holder
  name: "Identity Credential",
  format: "vc+sd-jwt",
  raw: compactSdJwt, // the credential as issued
  issuer: "did:web:issuer.example.com",
  receivedAt: Date.now(),
});
```

The binding buys you two behaviors:

- **Persona-scoped lookups**: `getCredentialsByIdentity(address)` returns one identity's credentials, so a multi-persona wallet never leaks credentials across personas.
- **Cascading cleanup**: `WithCredentials` watches the identities store, and removing an identity evicts its credentials automatically.

## Query credentials

Lookups use the Universal Wallet query shape, so a verifier's `QueryByExample` request maps straight onto the store. Queries are typed as `CredentialQuery[]`; the `example.type` (or nested `credentialQuery.example.type`) is matched against each credential's `type`, and query shapes the store does not understand match everything so a newer verifier never gets an empty answer by accident:

```typescript
import type { CredentialQuery } from "@algorandfoundation/credentials";

const queries: CredentialQuery[] = [
  {
    type: "QueryByExample",
    example: { type: ["VerifiableCredential", "IdentityCredential"] },
  },
];
const matches = await provider.credential.store.query(queries);
```

## Present a credential

For OID4VP presentations, the store hands you a signer bound to the holder identity, so the proof is made with the same key the credential was issued to:

```typescript
const signer = await provider.credential.store.getSignerForIdentity("did:key:z6Mk...");
```

On the web, requester-side flows can also go through the browser's Digital Credentials API, which lets the user agent show its native credential chooser:

```typescript
const response = await provider.credential.digital.get({
  requests: [{ protocol: "openid4vp-v1-unsigned", data: authorizationRequest }],
});
```

`provider.credential.digital` feature-detects `navigator.credentials`; on unsupported platforms it reports itself as unavailable rather than throwing at compose time.

## Track issuance sessions

Issuance rarely finishes in one call. The store mirrors in-flight OID4VC sessions so your UI can render progress and resume interrupted flows:

```typescript
await provider.credential.store.upsertIssuanceSession({
  id: "session-123",
  identityAddress: "did:key:z6Mk...",
  state: "offered",
  credentialConfigurationIds: ["university-degree"],
});
```

If your issuance backend is Intermezzo, the `WithIntermezzoCredentials` bridge (from `@algorandfoundation/credentials-intermezzo-extension`) keeps these mirrors in sync with the backend's sessions for you.

## Share credentials over a session

The domain exposes presentation metadata to the connections handshake as `CredentialRecord` entries: everything except `raw`, `claims`, and the local `receivedAt` timestamp. A connected peer can see what credentials exist and ask for a presentation, but the credential bytes stay in the wallet until the holder presents them deliberately.

## Related

- [Identities](/concepts/identities/) for the holder binding.
- [Manage identities](/guides/manage-identities/) to create the identities credentials bind to.
- [Connections](/concepts/connections/) for how credential metadata rides sessions.
