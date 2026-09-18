# Credentials Domain

The **Credentials** domain manages Verifiable Credentials held by the wallet, including storage, querying, OID4VC issuance and presentation flows, and the platform seam for the emerging W3C Digital Credentials API. It integrates with the [Identities domain](../identities) through the **holder-binding seam**: a credential holder is any domain that can sign as the user. This is currently an identity key (typically a holder `did:key`), but could eventually be a formal document such as an mDoc obtained via the Digital Credentials API, ensuring the domain never hard-depends on identities.

> 💡 **Recommended entry point:** use [`@algorandfoundation/credentials`](./meta), which is the meta-package with conditional platform exports, unless you specifically need to compose the building blocks yourself.

> 📐 **Architecture note:** [mDocs, the Keystore, and Self-Sovereign Identities](./docs/mdoc-key-model.md) records how government-issued mDocs relate to the keystore and SSI holder binding — self-held vs OS-held DeviceKeys, why `DeviceResponse` payloads are session-bound evidence rather than re-presentable credentials, and the bridging patterns between OS-held mDocs and keystore-bound identities.

## Responsibilities

- **Credential lifecycle**: add, remove, get, list, and query (Universal Wallet 2020 `QueryByExample`) credentials in any envelope (`vc+sd-jwt`, `jwt_vc_json`, `ldp_vc`, `mso_mdoc`, ...), persisted through a tiny key/value driver seam (`CredentialKeyValueStore`).
- **Holder scoping**: every credential and OID4VC session is bound to a holder address; with the `identityHolderBinding` adapter over [`@algorandfoundation/identities-core`](../identities/core), removing an identity cascade-evicts its credentials and sessions.
- **OID4VC flows**: parsing and redeeming OID4VCI credential offers (pre-authorized code grant, holder proof-of-possession), parsing OID4VP authorization requests, and assembling VP tokens and SD-JWT VC presentations with key-binding JWTs.
- **Digital Credentials seams**: minimal, `@experimental` contracts mirroring the W3C Digital Credentials API. This includes `DigitalCredentialsPlatform` for the _requester_ side (implemented for real in `credentials-web` via `navigator.credentials.get({ digital })`) and `DigitalCredentialsProvider` for the _wallet/holder_ side (OS credential registry + request handler). The Android holder side ships as the Expo native module bundled with `react-native-credentials` and is consumed through that package's injectable seam; the RN requester side and iOS `IdentityDocumentServices` remain future work.

## Packages

This domain follows the keystore-style layout: a platform-neutral core **engine** (no mounted extension of its own), per-platform packages that each export `WithCredentials`, a meta-package with conditional exports, a connections bridge, and an opt-in backend bridge.

### Configuration (`options.credentials`)

Every credentials extension reads the shared `options.credentials` namespace (`CredentialsNamespace`, registered on `ExtensionOptions` by `credentials-core`). Platform packages and bridges **augment** that one interface rather than registering a second `credentials` key, so a composition root gets a single fully typed block. The intermezzo bridge lives under its own `options.intermezzo` namespace (`IntermezzoNamespace`, registered by `credentials-intermezzo-extension`).

| Field                                  | Owner                              | Type                           | Default                                                    | Description                                                                                                   |
| -------------------------------------- | ---------------------------------- | ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `credentials.store`                    | `credentials-core`                 | `Store<CredentialStoreState>`  | new empty store                                            | Reactive TanStack store backing the engine. Also the (required) input of `WithCredentialsConnections`.        |
| `credentials.hooks`                    | `credentials-core`                 | `HookCollection`               | new collection                                             | `before-after-hook` collection guarding every store operation (exposed as `provider.credential.store.hooks`). |
| `credentials.driver`                   | `credentials-core`                 | `CredentialKeyValueStore`      | platform default (`localStorage` on web, memory elsewhere) | String key/value persistence seam for the durable `credentials` slice.                                        |
| `credentials.binding`                  | `credentials-core`                 | `HolderBinding`                | `identityHolderBinding(provider.identity.store)` if found  | Signer resolution + removal cascade for credential holders.                                                   |
| `credentials.storageKey`               | `credentials-core`                 | `string`                       | `DEFAULT_CREDENTIALS_KEY`                                  | Key under which the snapshot is serialized in the driver.                                                     |
| `credentials.digitalCredentialsModule` | `react-native-credentials`         | `DigitalCredentialsModuleLike` | bundled expo module (lazy) or `unsupported`                | Native Digital Credentials module backing `provider.credential.digitalProvider`.                              |
| `intermezzo.*`                         | `credentials-intermezzo-extension` | `IntermezzoNamespace`          | — (required by the bridge)                                 | Intermezzo host settings (`baseUrl`, `getAuthToken`, `client`, `pollIntervalMs`, ...).                        |

### Meta Package _(recommended)_

- [`@algorandfoundation/credentials`](./meta): a pure export-conditions resolver, exactly like [`@algorandfoundation/keystore`](../keystore/meta): `react-native` → `react-native-credentials`, `browser` → `credentials-web`, `node`/default → `credentials-node`. It contains no implementation of its own. One install covers the domain.

### Building Blocks

- **Core** ([@algorandfoundation/credentials-core](./core)): types, the `createCredentialStore` engine (reactive store + hooks + key/value persistence driver), the `HolderBinding` seam (+ `identityHolderBinding` adapter), the OID4VC/SD-JWT/`did:key` utilities, and the Digital Credentials API contracts (`DigitalCredentialsPlatform` for the requester side, `DigitalCredentialsProvider` for the wallet/holder side). It exports **no mounted extension**, exactly like `keystore-core`.
- **Platform Packages**: each exports its own `WithCredentials` built on the core engine (like every keystore platform package exports `WithKeyStore`):
  - [`@algorandfoundation/credentials-node`](./node): Node.js / server package. The persistence driver is injected by the app (in-memory when omitted); `provider.credential.digital` is a permanent explicit `unsupported` stub because node has no user-agent credential chooser.
  - [`@algorandfoundation/credentials-web`](./web): browser package. Default `localStorage` persistence driver; backs the Digital Credentials contract with a feature-detected `navigator.credentials.get({ digital })` / `.create(...)` implementation (typed `DigitalCredentialsUnsupportedError` on browsers without the API).
  - [`@algorandfoundation/react-native-credentials`](./react-native): React Native package, which is itself an Expo native module. The persistence driver is injected by the app (MMKV/AsyncStorage adapt in two lines). The **wallet/holder** side (`provider.credential.digitalProvider`) is backed on Android by the bundled Digital Credentials native module (Credential Manager registry `androidx.credentials.registry`, OpenID4VP default matcher, `GET_CREDENTIAL` fulfillment activity) and is consumed through the structural `DigitalCredentialsModuleLike` seam. The **requester** side (`provider.credential.digital`) is still an explicit `unsupported` stub, and iOS holder support lands later.
- **Backend Bridges** _(opt-in, not part of the meta)_
  - [`@algorandfoundation/credentials-intermezzo-extension`](./intermezzo-extension): bridges the credential store to an intermezzo backend (`provider.credential.intermezzo`: offers, presentation requests, session mirroring) via [`@algorandfoundation/intermezzo-client`](https://github.com/algorandfoundation/intermezzo-client-js).

## Architecture

```
        ┌────────────────────────────────────────────────────┐
        │                 Wallet / Provider                  │
        └─────────────────────────┬──────────────────────────┘
                                  │ imports
                  ┌───────────────▼────────────────┐
                  │ @algorandfoundation/credentials │  ← meta-package (pure resolver,
                  └──┬─────────────┬─────────────┬──┘    conditional exports)
             browser │  react-native │  node/default │
        ┌────────────▼──┐ ┌─────────▼─────────┐ ┌───▼──────────────┐
        │ credentials-  │ │ react-native-     │ │ credentials-node │  each: WithCredentials =
        │ web           │ │ credentials       │ │                  │  engine + platform driver
        └────────────┬──┘ └─────────┬─────────┘ └───┬──────────────┘  + DC API (web: requester,
                     │ createCredentialStore        │   RN: holder side, node: unsupported)
        ┌────────────▼──────────────▼───────────────▼──────────┐   ┌──────────────────┐
        │                  credentials-core                    │   │ credentials-     │
        │  engine · KV driver seam · options.credentials       │◀──│ intermezzo-      │ opt-in
        │  OID4VC utils · DC contracts                         │   │ extension        │
        └──────────┬───────────────────────────┬───────────────┘   └────────┬─────────┘
                   │ HolderBinding seam         │ shared store               │ HTTP
                   │ (identityHolderBinding)    │ (credential.remote)        ▼
        ┌──────────▼───────────────┐  ┌────────▼─────────────────┐  ┌──────────────────┐
        │ identities/core (+ meta) │  │ credentials-connections- │  │ intermezzo-client│
        │                          │  │ extension (lazy peer)    │  └──────────────────┘
        └──────────────────────────┘  └──────────────────────────┘
```

The meta-package stays **backend-agnostic**, meaning it never depends on the intermezzo bridge or its transport client. Applications targeting an intermezzo backend install `@algorandfoundation/credentials-intermezzo-extension` separately and mount it after `WithCredentials`. Every extension returns **only the surface it contributes** (the intermezzo bridge returns `{ credential: { ...provider.credential, intermezzo } }`, never a spread of the provider), so the reactive getters (`provider.credentials`, `issuanceSessions`, `verificationSessions`) stay live after any bridge is mounted. All barrels are named-exports only (no `export default`).

## Demo Pair (Digital Credentials API)

Two examples in this repository stage the Digital Credentials flow end-to-end:

- **Holder / wallet** ([`examples/react-native-wallet`](../examples/react-native-wallet)): mounts `WithCredentials` (MMKV-backed driver, identity holder binding) and **self-issues** a sample SD-JWT VC bound to one of its `did:key` identities. The wallet-side OS registry (`DigitalCredentialsProvider`, at `provider.credential.digitalProvider`) is available on Android through the Expo native module bundled with `react-native-credentials`, resolved by `WithCredentials` through its injectable seam.
- **Requester / verifier** ([`examples/use-wallet-client`](../examples/use-wallet-client)): a Vite + React dapp combining a [`use-wallet`](https://github.com/TxnLab/use-wallet) connection panel with `webDigitalCredentials.get(...)`, which is an unsigned OpenID4VP request (DCQL query for the demo credential) routed through `navigator.credentials.get({ digital })`.

With the bundled Android registry module compiled into the app, the wallet example registers its credentials with Credential Manager and answers the client example's requests, whether same-device on Android or cross-device from desktop Chrome/Edge.

## Relationship to Other Domains

- **Identities** (via the holder-binding seam): the platform `WithCredentials` extensions auto-wire `identityHolderBinding(provider.identity.store)` when an identities extension (`WithIdentities`) is mounted, providing signer resolution plus a `before('remove', …)` cascade so credentials and OID4VC sessions are evicted when their identity goes away. Without identities the store still mounts (future holder sources, such as Digital Credentials API mDocs, implement the same `HolderBinding` contract). The [`@algorandfoundation/identities-intermezzo-extension`](../identities/intermezzo-extension) bridge additionally consumes this domain's `did:key` utilities and presentation header for credential-gated DID operations.
- **Connections / Sessions**: [`@algorandfoundation/credentials-connections-extension`](./connections-extension) mounts the session-scoped remote mirror at `provider.credential.remote` over the shared `options.credentials.store`; the platform `WithCredentials` extensions load it lazily as an optional peer, and `await provider.credential.store.ready` guarantees it is mounted. Presentation-request handling itself stays transport-agnostic.
- **Accounts** _(future alignment)_: the accounts domain has largely been maintained by `use-wallet`. The credentials packages intentionally make no account assumptions beyond the `identities-core` contract, so a future alignment with formalized account primitives does not affect this domain.

## Adding a New Extension or Platform Implementation

### 1. Implement the Digital Credentials contract for a platform

1. Implement `DigitalCredentialsPlatform` from `@algorandfoundation/credentials-core` (`isSupported`, `get`, `create`), rejecting with `DigitalCredentialsUnsupportedError` when the underlying API is unavailable; never silently no-op. [`webDigitalCredentials`](./web/src/platform.ts) is the reference implementation (feature detection via the `DigitalCredential` interface object, request forwarding, response normalization).
2. Replace the platform package's stub (currently only `reactNativeDigitalCredentials`) with the real implementation; the package's `WithCredentials` extension already attaches it at `provider.credential.digital`.
3. Keep feature detection inside `isSupported()` so applications can branch without try/catch.
4. For the **wallet/holder** side (registering the wallet's credentials with the OS and answering routed presentation requests), implement the `DigitalCredentialsProvider` contract from `@algorandfoundation/credentials-core`, as this side is inherently native. On React Native the Android implementation already ships inside `react-native-credentials` as its Expo native module (Credential Manager registry `androidx.credentials.registry`, OpenID4VP default matcher, `GET_CREDENTIAL` fulfillment activity), mirroring the passkey-autofill module work. The package consumes it through the injectable `DigitalCredentialsModuleLike` seam (`nativeDigitalCredentialsProvider`), so follow that pattern and inject the native surface structurally instead of depending on it at compile time. iOS `IdentityDocumentServices` support remains future work.

### 2. Add a new backend bridge (e.g. a different issuer/verifier service)

1. **Create a new package** under `credentials/<your-backend>-extension` following the [file naming conventions](../AGENTS.md): `src/extension.ts`, `src/types.ts`.
2. **Depend on the credential store as the source of truth**: read `provider.credential.store`; never duplicate credential state.
3. **Translate backend sessions into store mirrors**: use `upsertIssuanceSession` / `upsertVerificationSession` rather than maintaining a parallel list.
4. **Return only the surface you contribute** from your extension function: `{ credential: { ...provider.credential, yourBackend: { … } } }`. Spreading the _namespace object_ is required because the Provider merges own property descriptors and replaces `credential` wholesale; spreading the _provider_ is a bug (it freezes reactive getters such as `provider.credentials` into snapshots). Do **not** mutate the provider directly.
5. **Register your options** on the shared registry: either augment `CredentialsNamespace` from `@algorandfoundation/credentials-core` (for `options.credentials.*` seams) or register your own `options.<backend>` namespace on `ExtensionOptions`, as the intermezzo bridge does with `IntermezzoNamespace`. Never register a second `credentials` key.
6. **Add tests** that exercise both pure store interactions and the bridge's lifecycle with a mocked client, including one asserting the returned object has only the `credential` key.
