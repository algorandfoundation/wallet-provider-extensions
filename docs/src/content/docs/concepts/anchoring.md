---
title: "Anchoring"
description: How a locally minted DID becomes resolvable on Algorand — did:algo, did:nfd, and credential-gated anchoring via intermezzo.
sidebar:
  order: 6
---

The [identities domain](/concepts/identities/) mints DIDs locally: a `did:key` is computed from a public key, its DID document is a projection of live store state, and nothing outside the wallet ever needs to know it exists. That self-containment is a feature — until someone else needs to resolve you. **Anchoring** is the act of publishing a locally minted DID to a _verifiable data registry_ (in this repo's case, the Algorand chain) so that any party can resolve the DID to its document without talking to your wallet.

This page explains the two Algorand-native DID methods you will meet — `did:algo` and `did:nfd` — and the mechanism this repo actually ships: intermezzo's credential-gated anchoring.

## Why anchor at all

A `did:key` encodes its own verification method: resolving it is pure math, no lookup required. But it has two limits:

1. **Nobody can discover it.** A verifier can check a signature against a `did:key`, but there is no registry to ask "does this identity exist, and what else does it declare?" — no service endpoints, no rotated keys, no revocation.
2. **It cannot change.** The DID _is_ the key. Rotate the key and you have a different DID.

Anchoring trades self-containment for resolvability: the DID document lives in a registry that others can query and the controller can update. On Algorand there are two ways to be that registry.

## did:algo — a contract as the registry

The [`did:algo` method](https://github.com/algorandfoundation/did-algo) stores each DID document in its own **Algorand application**: creating the DID means deploying a small contract whose box storage holds the document, and updating the document means calling that contract. The DID embeds the network and the storage location, so a resolver reads the document straight from chain state.

In this repo the flow is driven by [intermezzo](https://github.com/algorandfoundation/intermezzo) through the `WithIntermezzoIdentities` bridge (`@algorandfoundation/identities-intermezzo-extension`), mounted at `provider.identity.intermezzo`:

```typescript
const { submitResponse } = await provider.identity.intermezzo.anchorIdentity({
  identityAddress: "did:key:z6Mk...",
  credentialPresentation: compactSdJwtVc,
});
console.log(submitResponse.did); // did:algo:...
```

`anchorIdentity` is an end-to-end upgrade path from `did:key` to `did:algo`:

1. **Build.** Intermezzo assembles the create-app atomic transaction group for the DID contract. The request is gated by a credential presentation (next section).
2. **Sign.** The wallet Ed25519-signs its owned positions in the group with the identity's own key — the same `did:key` material the identities-keystore bridge projected, adapted into an Algorand signer by `createIdentityAlgorandSigner`.
3. **Submit.** Intermezzo submits the group and returns the resulting `did:algo`. The bridge records the **anchor snapshot** in the identity's `metadata`, so the store remembers which chain record mirrors this identity.

The identity keeps its address; anchoring adds a resolvable on-chain twin. Resolution goes through the `did:algo` resolver (intermezzo ships a [credo](https://credo.js.org/) resolver for it), which reads the document from the contract's storage.

## did:nfd — the name contract is the registry

[NFDs](https://app.nf.domains/) (Non-Fungible Domains, by TxnLab) are Algorand naming smart contracts, and the [`did:nfd` method](https://github.com/TxnLab/nfd-did) makes the NFD application itself the DID registry. `did:nfd:alice.algo` needs **no anchoring transaction at all**: if you own the NFD, the DID already exists.

The trick is that the DID document is a **resolver-side projection of on-chain NFD state**, the same "the document is a projection" idea the identities domain applies to its keystore — just with the chain as the store:

- the NFD's owner account (`i.owner`) becomes the `#owner` verification method;
- each **verified** linked account in `v.caAlgo` becomes an `#algo-0`, `#algo-1`, ... verification method, giving one DID over many Algorand accounts;
- updating the document means updating the NFD (transfer the name, verify or unlink accounts) through the NFD contract's own operations.

So "anchoring to an NFD" is not a publish step — it is _owning and maintaining the name_. The registry entry lives exactly as long as the NFD does, and control of the DID follows control of the name.

This repo ships no `did:nfd` resolver today. The identities model is ready for it, though: `BaseIdentity.type` is an open union, so a bridge that resolves NFDs would store such identities as just another `type: "did:nfd"` alongside `did:key` and `did:algo`.

## Anchoring based on credentials

Publishing to a shared registry is exactly the kind of operation a backend does not want to offer anonymously — chain writes cost money and pollute the registry if abused. Intermezzo's answer is to gate anchoring **on a credential presentation**: every build/submit endpoint of the `did:algo` flow requires a compact **SD-JWT VC** presentation, forwarded as the `x-credential-presentation` header.

Today that credential is a **device attestation**: a credential the wallet earned by proving (via the [passkeys domain](/guides/track-passkeys/) and intermezzo's issuance flow) that it controls the hardware-bound keys it claims. Presenting it before anchoring ties every on-chain anchor to a wallet that demonstrably holds its keys — the registry only accumulates entries from attested devices.

The mechanism is general, not attestation-specific: the gate accepts whatever credential class the backend's verification policy demands, so "anchoring based on credentials" scales from device attestation to KYC credentials, memberships, or anything else expressible as an SD-JWT VC. The wallet-side pieces compose accordingly:

- the [credentials domain](/guides/hold-credentials/) holds the SD-JWT VC and produces the presentation;
- `WithIntermezzoCredentials` (`@algorandfoundation/credentials-intermezzo-extension`) drives issuance and verification against intermezzo;
- `WithIntermezzoIdentities` performs the anchoring, and both bridges can share one `IntermezzoClient` (pass it via `options.intermezzo.client`) so the credential that gates the anchor and the anchor itself travel the same authenticated session.

## Choosing a method

|                | `did:key` (unanchored)               | `did:algo`                                          | `did:nfd`                             |
| -------------- | ------------------------------------ | --------------------------------------------------- | ------------------------------------- |
| Registry       | none (self-contained)                | per-DID Algorand application                        | the NFD naming contract               |
| Anchoring step | —                                    | credential-gated contract deployment via intermezzo | none — own/verify the name            |
| Document       | computed from the key                | stored on chain, updatable                          | projected from NFD state              |
| Key rotation   | impossible (DID = key)               | update the contract's document                      | re-verify linked accounts             |
| Human-readable | no                                   | no                                                  | yes (`alice.algo`)                    |
| Shipped here   | ✅ identities core + keystore bridge | ✅ `identities-intermezzo-extension`                | ❌ described only (open `type` union) |

## Where to go next

- [Identities](/concepts/identities/) for the domain model that anchoring publishes.
- [Manage identities](/guides/manage-identities/) for the concrete operations.
- The [identities-intermezzo-extension README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/identities/intermezzo-extension#readme) for the full `anchorIdentity` API.
