---
title: "Identities"
description: How the identities domain models DIDs, projects DID documents, and anchors identity on chain.
sidebar:
  order: 5
---

Accounts answer "what can spend". Identities answer "who is this". The identities domain manages **decentralized identifiers (DIDs)** and their **DID documents**, the W3C standard way to say "this is me, and these are the keys that prove it". If your wallet holds credentials, signs in to services, or backs itself up as a portable document, this is the domain doing the work.

Like every package in this repo, identities work standalone, as `addIdentity` and the DID helpers are pure functions over a plain store (see the [identities-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/identities/core#readme)), while `WithIdentities` provides first-class Provider integration.

## The identity model

```typescript
export interface BaseIdentity {
  address: string; // e.g. did:key:z6Mk...
  type: "xhd" | "did:key" | string;
  metadata?: Record<string, any>;
}

export interface Identity extends BaseIdentity {
  did?: string;
  didDocument?: DIDDocument;
  sign?: (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}
```

As with accounts, the type union is open. `xhd` marks an identity derived from the wallet's own HD seed, `did:key` is a self-describing DID computed from a public key, and the trailing `string` admits shapes like `did:web` or an mdoc that a bridge of yours introduces. `didDocument` is optional and `metadata` is free-form, so an identity that is not a classic DID still has somewhere to live.

## The DID document is a projection

A DID document lists a DID's verification methods (its public keys), what each may be used for, and any service endpoints. In this system the document is never hand-written. The identities keystore bridge derives it from live store state: every identity-context key in the keystore appears as a verification method, passkeys appear alongside Ed25519 keys, and services are appended from configuration.

Because the document is a projection, it is never stale, and it doubles as a **backup format**. The bridge can also run the projection in reverse:

```typescript
await provider.identity.store.restoreFromDidDocument(doc);
```

Given a document and a keystore that already holds the recovery seed, `restoreFromDidDocument` re-derives exactly the keys the document describes. Import the phrase, feed in the document, and the wallet is back. [Provider](/concepts/provider/) explains why this falls out of the architecture rather than being a feature someone maintains.

## Where identities come from

**The keystore bridge.** `WithIdentitiesKeystore` watches the keystore and turns each identity-context key (context 1) into an identity with a `did:key` and a projected document. When any key in a seed's hierarchy changes, it refreshes every affected document. The `WithIdentities` meta extension loads this bridge for you whenever the provider has a keystore.

**Remote sessions.** Peers share identity records during a connection handshake, tagged with `metadata.source: "connection"` and their `sessionId`, so they can be revoked precisely when the session ends.

**You.** Any DID you resolve, import, or receive can go straight into the store with `addIdentity`, whatever its method.

## Anchoring on chain

A `did:key` is self-contained but unpublished; nothing on chain knows it exists. The Intermezzo bridge (`WithIntermezzoIdentities`) can **anchor** an identity to Algorand, producing a resolvable `did:algo` — gated on presenting a credential as a compact SD-JWT VC. [Anchoring](/concepts/anchoring/) covers the whole story: `did:algo`, `did:nfd`, and credential-gated anchoring.

## Identities are the spine for credentials

The credentials domain binds every stored credential to a holder identity through its `identityAddress`. That gives you persona-scoped credential lookups for free, and a cascade: remove an identity and its credentials are evicted with it. See [Hold verifiable credentials](/guides/hold-credentials/).

## Where to go next

- [Manage identities](/guides/manage-identities/) for the concrete operations.
- [Add a new account or identity type](/guides/add-account-types/) to introduce your own identity shapes.
- The [API reference](/reference/) for `DIDDocument`, `generateDidKey`, and friends.
