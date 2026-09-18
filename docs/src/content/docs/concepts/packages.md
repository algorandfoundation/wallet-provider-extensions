---
title: "Packages"
description: How the workspace is organized into stores, bridges, and meta packages.
sidebar:
  order: 9
---

Every domain in this repository is built from the same three layers. Once you recognize the pattern, the whole workspace reads the same way.

## The pattern: store, bridges, meta

**Generic store.** Each domain is built around a generic store that holds the canonical state and exposes a small, pure API. Stores are intentionally source-agnostic: they do not require a keystore, or even a Provider. Every domain ships standalone entry points (pure store functions or an engine factory) as first-class peers of its `With*` extension, so records can just as easily come from an RPC service, an indexer, a remote wallet, or any other producer.

**Bridge extensions.** On top of each store, the project ships optional bridges that wire the store to a specific source or seam: the local keystore (`<domain>-keystore-extension`), a backend (`<domain>-intermezzo-extension`), or the connections domain seam (`<domain>-connections-extension`, which mounts the store's session-scoped remote mirror at `provider.<ns>.remote`).

**Meta package.** A unified extension per domain bundles the store plus any optional bridges, conditionally enabling them only when the underlying dependency is present.

:::tip[Recommended]
For most developers, the meta package for each domain is the best entry point. It hides the wiring between stores and bridges, enables capabilities based on what the provider exposes, and lets you opt down to the generic store or individual bridges only when you need finer control.
:::

## Keystore

Cryptographic key material management: generation, derivation, and secure storage.

| Package                                     | Folder                  | Role                                                        |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `@algorandfoundation/keystore`              | `keystore/meta`         | Meta package that picks the right adapter for your runtime. |
| `@algorandfoundation/keystore-core`         | `keystore/core`         | The shared engine: types, shims, errors.                    |
| `@algorandfoundation/keystore-node`         | `keystore/node`         | Node adapter, plus the `keystore` CLI and RPC service.      |
| `@algorandfoundation/keystore-web`          | `keystore/web`          | Browser adapter (IndexedDB).                                |
| `@algorandfoundation/react-native-keystore` | `keystore/react-native` | Mobile adapter (device keychain, biometrics).               |

If you are building an app, install the meta package. In Node it quietly uses the Node adapter, in a browser the web adapter, and so on. React Native is the one exception where you install the adapter directly, because native modules must be linked at build time.

**Standalone entry points:** the shared engine `createKeyStore` (core) and the platform engines built on it (`createWebKeyStore`, `createNodeKeyStore`) run with no Provider; each platform package also exports the `WithKeyStore` extension that mounts the same engine on a provider.

## Accounts

On-chain account lifecycle. Accounts may be backed by keystore-managed keys, or sourced from third parties such as RPC services, indexers, or watch-only feeds.

| Package                                              | Folder                           | Role                                                              |
| ---------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `@algorandfoundation/accounts`                       | `accounts/meta`                  | Meta package; the entry point apps import `WithAccounts` from.    |
| `@algorandfoundation/accounts-core`                  | `accounts/core`                  | The accounts API and reactive store, source-independent.          |
| `@algorandfoundation/accounts-keystore-extension`    | `accounts/keystore-extension`    | Example bridge populating accounts from keystore-derived keys.    |
| `@algorandfoundation/algorand-accounts-extension`    | `accounts/algorand-extension`    | Algorand bridge: concrete addresses, balances, and asset data.    |
| `@algorandfoundation/accounts-connections-extension` | `accounts/connections-extension` | Bridge mounting the session-scoped remote mirror for connections. |

**Standalone entry points:** pure store functions from `accounts-core`, such as `addAccount`, `removeAccount`, `getAccount`, `setActiveAccount`, and `clearAccounts`, over a plain `@tanstack/store` `Store`; `WithAccounts` mounts the same functions on a provider.

## Identities

Decentralized identity (DID) management. Identities can be derived from keystore-managed seeds, but the store itself is generic and can equally hold imported, resolved, or remotely issued DIDs.

| Package                                                | Folder                             | Role                                                              |
| ------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------- |
| `@algorandfoundation/identities`                       | `identities/meta`                  | Meta package owning the unified `WithIdentities` extension.       |
| `@algorandfoundation/identities-core`                  | `identities/core`                  | The identities API, reactive store, and DID document helpers.     |
| `@algorandfoundation/identities-keystore-extension`    | `identities/keystore-extension`    | Bridge that builds DID documents from keystore-managed seeds.     |
| `@algorandfoundation/identities-intermezzo-extension`  | `identities/intermezzo-extension`  | Bridge that anchors identities on chain as `did:algo`.            |
| `@algorandfoundation/identities-connections-extension` | `identities/connections-extension` | Bridge mounting the session-scoped remote mirror for connections. |

**Standalone entry points:** pure store functions from `identities-core` (`addIdentity`, `removeIdentity`, `updateIdentityDidDocument`), plus the DID helpers `generateDidKey` and `generateDidDocument`; `WithIdentities` provides the Provider path.

## Connections

Remote sessions between wallets and dapps: pairing, persistence, remote signing, and encrypted messaging.

| Package                                        | Folder                     | Role                                                                 |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `@algorandfoundation/connections`              | `connections/meta`         | Meta package; resolves the engine for your runtime.                  |
| `@algorandfoundation/connections-core`         | `connections/core`         | Session and message store, RPC layer, secure channel, plug-in seams. |
| `@algorandfoundation/connections-liquid-auth`  | `connections/liquid-auth`  | The Liquid Auth protocol plug-in (QR pairing, WebRTC transport).     |
| `@algorandfoundation/connections-web`          | `connections/web`          | Browser engine (requester side, for dapps).                          |
| `@algorandfoundation/react-native-connections` | `connections/react-native` | Mobile engine (responder side, for wallets).                         |

**Standalone entry points:** the `createConnectionsStore` engine factory from `connections-core` runs with no Provider; `WithConnections` mounts it on a provider.

## Credentials

Verifiable credential storage and the issuance and presentation flows around it.

| Package                                                 | Folder                              | Role                                                                  |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `@algorandfoundation/credentials`                       | `credentials/meta`                  | Meta package with per-platform conditional exports.                   |
| `@algorandfoundation/credentials-core`                  | `credentials/core`                  | The credential store, OID4VC and SD-JWT logic.                        |
| `@algorandfoundation/credentials-web`                   | `credentials/web`                   | Browser persistence and the Digital Credentials API requester.        |
| `@algorandfoundation/react-native-credentials`          | `credentials/react-native`          | Android Credential Manager integration (holder side).                 |
| `@algorandfoundation/credentials-node`                  | `credentials/node`                  | Node.js persistence and a stub requester for servers, CLIs and tests. |
| `@algorandfoundation/credentials-intermezzo-extension`  | `credentials/intermezzo-extension`  | Bridge that mirrors Intermezzo issuance and verification sessions.    |
| `@algorandfoundation/credentials-connections-extension` | `credentials/connections-extension` | Bridge mounting the session-scoped remote mirror for connections.     |

**Standalone entry points:** the `createCredentialStore` engine factory from `credentials-core` (plus its OID4VC and SD-JWT utilities) needs no Provider; the platform and meta packages export the `WithCredentials` extension.

## Passkeys

A public-record inventory of the wallet's passkeys for rendering and server reconciliation.

| Package                                              | Folder                           | Role                                                              |
| ---------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `@algorandfoundation/passkeys`                       | `passkeys/meta`                  | Meta package owning the unified `WithPasskeys` extension.         |
| `@algorandfoundation/passkeys-core`                  | `passkeys/core`                  | The passkey store functions and reconcile logic.                  |
| `@algorandfoundation/passkeys-keystore-extension`    | `passkeys/keystore-extension`    | Bridge mirroring keystore-derived P256 domain keys as passkeys.   |
| `@algorandfoundation/passkeys-connections-extension` | `passkeys/connections-extension` | Bridge mounting the session-scoped remote mirror for connections. |
| `@algorandfoundation/react-native-passkeys`          | `passkeys/react-native`          | Native feeder syncing the mobile credential provider.             |

**Standalone entry points:** pure store functions from `passkeys-core` (`addPasskey`, `removePasskey`, `getPasskey`, `getPasskeys`, `clearPasskeys`) plus the pure `reconcilePasskeys` helper run with no Provider; `WithPasskeys` mounts the same functions on a provider.

## Cross-cutting

Extensions that serve every domain rather than owning one.

| Package                                   | Folder       | Role                                                   |
| ----------------------------------------- | ------------ | ------------------------------------------------------ |
| `@algorandfoundation/logs`                | `logs`       | Generalized logging store for wallet activity.         |
| `@algorandfoundation/provider-migrations` | `migrations` | Revision-tracked migrations for persisted wallet data. |

**Standalone entry points:** `@algorandfoundation/logs` exposes pure store functions (`addLog`, `removeLog`, `getLog`, `clearLogs`) with `WithLogs` as its Provider extension; `@algorandfoundation/provider-migrations` exposes the pure `applyMigrations` engine with `WithMigrations` as its Provider extension.

## Why the split matters: dependency isolation

Nothing pulls chain-specific code unless it actually uses a chain-specific package. The generic stores depend only on generic primitives (hashing, base-N encoding, the store, the hook library). There is no `algosdk` or chain SDK in any of them, so they remain reusable for a chain that is not Algorand at all.

The rule of thumb when you add your own package: **generic packages carry generic dependencies; chain packages carry chain dependencies.** Your bridge is the one place that carries the chain SDK. Install the bridge and you opt into that SDK; leave it out and neither it nor its transitive weight is in your bundle. `sideEffects: false` on these packages lets bundlers tree-shake unused paths away entirely.

## Runnable examples

The repository ships example apps under `examples/` that show all of this wired together end to end: a Node keystore script, a web keystore app, a React Native wallet, and a `use-wallet` dapp client that connects to that wallet through the adapter described in [dApps](/concepts/dapps/).

## Related

- [Compose a provider](/guides/compose-a-provider/)
- [API reference](/reference/)
