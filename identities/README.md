# Identities Domain

The **Identities** domain manages decentralized identifiers (DIDs) and the DID documents that describe them. It is the bridge between a wallet's cryptographic material and the standardized identity layer (verification methods, services, controller relationships) consumed by external systems.

> 💡 **Recommended entry point:** use [`@algorandfoundation/identities`](./meta) — the meta-package with conditional platform exports — unless you specifically need to compose the building blocks yourself.

## Responsibilities

- **DID lifecycle** — create, resolve, update, and remove identities backed by either local keys or externally-issued documents.
- **DID document assembly** — build verification methods, services, and controller relationships from the keys available in the wallet.
- **Seed-based hierarchy** — when a keystore is present, an identity is tied to a **seed** and inherits all of its derived keys (ed25519, p256, passkeys) as verification methods. Adding or removing a derived key under a seed updates the related identity's DID document automatically.
- **Source-agnostic state** — the generic store does not assume the wallet owns the underlying keys. Identities can equally be imported, resolved from a registry, or remotely-issued.

## Packages

This domain is split into a generic store, an optional keystore source bridge, a unified extension that ties them together, and a meta-package with conditional platform exports on top.

### Meta Package _(recommended)_

- [`@algorandfoundation/identities`](./meta) — keystore-style meta with conditional `exports` (`react-native` / `browser` / `node`). Today every condition resolves to the same platform-neutral composition (store + unified `WithIdentities`); per-platform identities packages (e.g. an mDoc-backed identity source via the Digital Credentials API) will slot in later without any application-facing change.

### Unified Extension

- [`@algorandfoundation/identities-extension`](./extension) — bundles the identity store with the keystore bridge and **dynamically loads the bridge only when the provider exposes a keystore**. Compatible with React Native (Metro) and standard ESM bundlers.

### Building Blocks

- **Generic Store** — [`@algorandfoundation/identities-store`](./store): types, the reactive identity store, and the `WithIdentityStore` extension. Source-agnostic.
- **Source Bridges**
  - [`@algorandfoundation/identities-keystore-extension`](./keystore-extension): optional bridge that builds DID documents from keystore-managed seeds and their derived keys, and restores identities from existing DID documents back into the keystore lineage.
- **Backend Bridges** _(opt-in, not part of the unified extension)_
  - [`@algorandfoundation/identities-intermezzo-extension`](./intermezzo-extension): bridges the identities surface to an [intermezzo](https://github.com/algorandfoundation/intermezzo) backend at `provider.identity.intermezzo` — manager identity endpoints, credential-gated `did:algo` contract anchoring (`anchorIdentity`) and DID-document update flows, plus an algokit-utils Algorand signer derived from an identity's `did:key`. Pairs with [`@algorandfoundation/credentials-intermezzo-extension`](../credentials/intermezzo-extension) and can share a single `IntermezzoClient` instance via `options.intermezzo.client`.

## Architecture

```
        ┌────────────────────────────────────────────┐
        │             Wallet / Provider              │
        └───────────────────┬────────────────────────┘
                            │ uses
                ┌───────────▼────────────────┐
                │      WithIdentities        │  ← unified meta-extension
                │  (composes store + bridges)│
                └───────────┬────────────────┘
                            │
        ┌───────────────────┼────────────────────────┐
        │                   │                        │
┌───────▼───────┐   ┌───────▼────────┐      ┌────────▼────────┐
│ IdentityStore │   │  Keystore      │      │   Remote /      │
│  (generic)    │◀──│  bridge        │      │   imported DIDs │
│               │   │ (conditional)  │      │     (TODO)      │
└───────────────┘   └────────────────┘      └─────────────────┘
```

The keystore bridge is loaded **dynamically** by the unified extension — if the provider doesn't expose `provider.key.store`, only the generic store is active, and identities can still be populated from any other source.

## Adding a New Extension or Source Bridge

### 1. Add a new identity source (e.g. a DID resolver, a remote issuer, an imported document feed)

1. **Create a new package** under `identities/<your-source>` following the [file naming conventions](../AGENTS.md): `src/extension.ts`, `src/store.ts`, `src/types.ts`, `src/errors.ts`.
2. **Depend on the identity store as the source of truth** — accept it via options or read `provider.identity.store`. Never duplicate identity state.
3. **Translate your source's events into store mutations** — use `addIdentity`, `updateIdentity`, `removeIdentity` from `@algorandfoundation/identities-store` rather than maintaining a parallel list.
4. **Populate `metadata` consistently** — e.g. `metadata.source`, `metadata.keyId` (when correlated with a keystore key). The unified extension and downstream consumers use these fields to surface lineage and capability.
5. **Return the API shape** from your extension function (e.g. `{ identityResolver: { … } }`). The provider's merging logic will compose it with the existing identity API. Do **not** mutate the provider directly.
6. **Add tests** that exercise both pure store interactions and the bridge's lifecycle.
7. **Hook into the unified extension when ready** — once stable, surface your bridge through `WithIdentities` with conditional / dynamic loading following the pattern in `identities/extension/src/extension.ts`.
8. **Register the package** in `pnpm-workspace.yaml`, add a `README.md`, and link it from the [workspace README](../README.md) under the **Identities** domain.

### 2. Extend the existing identity model (verification methods, services, capabilities)

If you want to teach identities a new trick — for example, attaching credential services, signing JWTs, or emitting verifiable presentations — you don't need a new bridge:

1. Create an extension that depends on `identities` (optional / incremental / hard — see the [Extension Dependencies](../AGENTS.md) section).
2. Read from `provider.identities` / `provider.identity.store` and call existing identity APIs (`provider.identity.create`, `provider.identity.update`, …) rather than mutating DID documents directly.
3. Use **hooks** (e.g. `provider.identity.hooks.after("create", …)`) to enrich identities at well-defined points in their lifecycle.
4. Expose your capability as its own API surface (`{ credentials: { … } }`).

### Designing your extension API

- **Pure methods over classes** — keep state in the identity store; only allow classes for custom error types.
- **Typedoc on every public surface** with at least one example.
- **Hooks-first** for composition with other identity extensions and the unified meta-package.
- **ESM only**, `strict` TypeScript, `erasableSyntaxOnly` — match the workspace settings.
- **Dynamic imports** for optional bridges to preserve React Native / Metro compatibility (see `identities/extension/src/extension.ts`).

## Related Domains

- [Keystore](../keystore) — supplies the seeds and derived keys that the keystore bridge converts into verification methods.
- [Accounts](../accounts) — accounts and identities frequently share a `metadata.keyId` lineage, allowing UIs to navigate from a DID to the accounts it can authorize.
- [Observability / Log](../log) — identity bridges can emit lifecycle events for auditing DID-document changes.
