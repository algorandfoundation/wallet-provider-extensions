# Credentials Domain

The **Credentials** domain manages Verifiable Credentials held by the wallet — storage, querying, OID4VC issuance and presentation flows, and the platform seam for the emerging W3C Digital Credentials API. It integrates with the [Identities domain](../identities) through the **holder-binding seam**: a credential holder is any domain that can sign as the user — today an identity key (typically a holder `did:key`), tomorrow possibly a formal document such as an mDoc obtained via the Digital Credentials API — so the domain never hard-depends on identities.

> 💡 **Recommended entry point:** use [`@algorandfoundation/credentials`](./meta) — the meta-package with conditional platform exports — unless you specifically need to compose the building blocks yourself.

## Responsibilities

- **Credential lifecycle** — add, remove, get, list, and query (Universal Wallet 2020 `QueryByExample`) credentials in any envelope (`vc+sd-jwt`, `jwt_vc_json`, `ldp_vc`, `mso_mdoc`, ...), persisted through a tiny key/value driver seam (`CredentialKeyValueStore`).
- **Holder scoping** — every credential and OID4VC session is bound to a holder address; with the `identityHolderBinding` adapter over [`@algorandfoundation/identities-store`](../identities/store), removing an identity cascade-evicts its credentials and sessions.
- **OID4VC flows** — parsing and redeeming OID4VCI credential offers (pre-authorized code grant, holder proof-of-possession), parsing OID4VP authorization requests, and assembling VP tokens and SD-JWT VC presentations with key-binding JWTs.
- **Digital Credentials platform seam** — a minimal, `@experimental` contract (`DigitalCredentialsPlatform`) mirroring the W3C Digital Credentials API, so per-platform implementations (browser `navigator.credentials.get({ digital })`, Android Credential Manager) can slot in without changing app code.

## Packages

This domain follows the keystore-style layout: a platform-neutral core **engine** (no mounted extension of its own), per-platform packages that each export `WithCredentials`, a meta-package with conditional exports, and an opt-in backend bridge.

### Meta Package _(recommended)_

- [`@algorandfoundation/credentials`](./meta) — conditional `exports` select the right platform implementation (`react-native` → `react-native-credentials`, `browser` → `credentials-web`, `node`/default → the core surface plus a node `WithCredentials`). One install covers the domain.

### Building Blocks

- **Core** — [`@algorandfoundation/credentials-core`](./core): types, the `createCredentialStore` engine (reactive store + hooks + key/value persistence driver), the `HolderBinding` seam (+ `identityHolderBinding` adapter), the OID4VC/SD-JWT/`did:key` utilities, and the `DigitalCredentialsPlatform` contract. Exports **no mounted extension** — exactly like `keystore-core`.
- **Platform Packages** — each exports its own `WithCredentials` built on the core engine (like every keystore platform package exports `WithKeyStore`):
  - [`@algorandfoundation/credentials-web`](./web): browser package. Default `localStorage` persistence driver; will back the Digital Credentials contract with `navigator.credentials.get({ digital })` (currently an explicit `unsupported` stub).
  - [`@algorandfoundation/react-native-credentials`](./react-native): React Native package. Persistence driver injected by the app (MMKV/AsyncStorage adapt in two lines); Android Credential Manager / iOS backing lands later (currently an explicit `unsupported` stub).
- **Backend Bridges** _(opt-in, not part of the meta)_
  - [`@algorandfoundation/credentials-intermezzo-extension`](./intermezzo-extension): bridges the credential store to an intermezzo backend (`provider.credential.intermezzo`: offers, presentation requests, session mirroring) via [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js).

## Architecture

```
        ┌────────────────────────────────────────────┐
        │             Wallet / Provider              │
        └───────────────────┬────────────────────────┘
                            │ imports
              ┌─────────────▼───────────────┐
              │ @algorandfoundation/        │  ← meta-package
              │        credentials          │    (conditional exports)
              └──┬──────────┬──────────┬────┘
        browser │   react-native │    │ node/default (own WithCredentials)
        ┌───────▼──────┐ ┌───────▼──────────┐
        │ credentials- │ │ react-native-    │   each: WithCredentials =
        │ web          │ │ credentials      │   engine + platform driver
        └───────┬──────┘ └───────┬──────────┘   + DC API stub
                │ createCredentialStore │
        ┌───────▼────────────────▼──────────┐        ┌──────────────────┐
        │      credentials-core             │  opt-in│ credentials-     │
        │  engine · KV driver seam ·        │◀───────│ intermezzo-      │
        │  OID4VC utils · DC contract       │        │ extension        │
        └───────────────┬───────────────────┘        └────────┬─────────┘
                        │ HolderBinding seam                  │ HTTP
                        │ (identityHolderBinding adapter)     ▼
        ┌───────────────▼───────────────────┐        ┌──────────────────┐
        │  identities/store (+ extension)   │        │ intermezzo-client│
        └───────────────────────────────────┘        └──────────────────┘
```

The meta-package stays **backend-agnostic** — it never depends on the intermezzo bridge or its transport client. Applications targeting an intermezzo backend install `@algorandfoundation/credentials-intermezzo-extension` separately and mount it after `WithCredentials`.

## Relationship to Other Domains

- **Identities** (via the holder-binding seam): the platform `WithCredentials` extensions auto-wire `identityHolderBinding(provider.identity.store)` when an identities extension is mounted — signer resolution plus a `before('remove', …)` cascade so credentials and OID4VC sessions are evicted when their identity goes away. Without identities the store still mounts (future holder sources — e.g. Digital Credentials API mDocs — implement the same `HolderBinding` contract). The [`@algorandfoundation/identities-intermezzo-extension`](../identities/intermezzo-extension) bridge additionally consumes this domain's `did:key` utilities and presentation header for credential-gated DID operations.
- **Connections / Sessions** _(future)_: liquid-auth style connection and session management will land in dedicated domains; the credentials layout deliberately keeps presentation-request handling transport-agnostic so those domains can drive it.
- **Accounts** _(future alignment)_: the accounts domain has largely been maintained by `use-wallet`. The credentials packages intentionally make no account assumptions beyond the `identities-store` contract, so a future alignment with formalized account primitives does not affect this domain.

## Adding a New Extension or Platform Implementation

### 1. Implement the Digital Credentials contract for a platform

1. Implement `DigitalCredentialsPlatform` from `@algorandfoundation/credentials-core` (`isSupported`, `get`, `create`), rejecting with `DigitalCredentialsUnsupportedError` when the underlying API is unavailable — never silently no-op.
2. Replace the platform package's stub (`webDigitalCredentials` / `reactNativeDigitalCredentials`) with the real implementation; the package's `WithCredentials` extension already attaches it at `provider.credential.digital`.
3. Keep feature detection inside `isSupported()` so applications can branch without try/catch.

### 2. Add a new backend bridge (e.g. a different issuer/verifier service)

1. **Create a new package** under `credentials/<your-backend>-extension` following the [file naming conventions](../AGENTS.md): `src/extension.ts`, `src/types.ts`.
2. **Depend on the credential store as the source of truth** — read `provider.credential.store`; never duplicate credential state.
3. **Translate backend sessions into store mirrors** — use `upsertIssuanceSession` / `upsertVerificationSession` rather than maintaining a parallel list.
4. **Return the API shape** from your extension function (e.g. `{ credential: { yourBackend: { … } } }`). The provider's merging logic composes it with the existing credential API. Do **not** mutate the provider directly.
5. **Add tests** that exercise both pure store interactions and the bridge's lifecycle with a mocked client.
