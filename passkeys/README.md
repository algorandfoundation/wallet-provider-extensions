# Passkeys Domain

The **Passkeys** domain keeps a **public-record inventory** of the wallet's passkeys: which credentials it holds, for which relying parties, and whether the server still knows them. Private key material never enters the store; secrets stay in the backing keystore or the native credential provider, and **feeders** strip every private field before a record crosses into the reactive state.

> 💡 **Recommended entry point:** use [`@algorandfoundation/passkeys`](./meta) (the meta-package owning the unified `WithPasskeys` extension) on web/Node, and [`@algorandfoundation/react-native-passkeys`](./react-native) on React Native, unless you specifically need to compose the building blocks yourself.

## Responsibilities

- **Inventory**: add, remove, look up, and list passkey records (`Passkey`) in a reactive `@tanstack/store` `Store<PasskeysState>`.
- **Server reconciliation**: compare the local inventory against the WebAuthn request options a relying party hands out (`reconcilePasskeys`) to spot local strays and server-side credentials this device is missing.
- **Source-agnostic state**: the store never assumes where a passkey comes from; the keystore bridge, the native feeder, and the connections mirror all write into the same store instance.

## Packages

This domain is split into a core package (the passkeys API + store), optional source bridges, a React Native platform package, and a meta-package on top that owns the unified `WithPasskeys` extension.

### Meta Package _(recommended)_

- [`@algorandfoundation/passkeys`](./meta): owns the unified `WithPasskeys` extension: the core store plus the lazily loaded connections bridge (the session-scoped remote mirror at `provider.passkey.remote`). `provider.passkey.store.ready` settles once that optional peer resolved.

### Building Blocks

- **Core** ([`@algorandfoundation/passkeys-core`](./core)): types, the reactive passkeys store and its pure store functions, the reconcile helpers, and the core `WithPasskeys` extension. Registers the `options.passkeys` namespace (`PasskeysNamespace`) on the shared `ExtensionOptions` registry; every other package below augments it.
- **Source Bridges**
  - [`@algorandfoundation/passkeys-keystore-extension`](./keystore-extension): `WithPasskeysKeystore` mirrors the keystore's derived P256 domain keys (the wallet's own WebAuthn credential keys) into the store and propagates passkey removals back to the keystore. Mounted explicitly after a keystore extension and `WithPasskeys`; adds `options.passkeys.keystore`.
  - [`@algorandfoundation/passkeys-connections-extension`](./connections-extension): `WithPasskeysConnections` mounts the store's session-scoped remote mirror (`expose` / `receive` / `revoke`) at `provider.passkey.remote`, the surface the connections engines duck-type to exchange passkey metadata.
- **Platform**
  - [`@algorandfoundation/react-native-passkeys`](./react-native): the React Native entry point. Re-exports the core and ships the native feeder over `@algorandfoundation/react-native-passkey-autofill`; its `WithPasskeys` composes the core with the feeder and the provider probes (`ready`, `refresh`, `providerActive`, `openProviderSettings`). Adds `options.passkeys.module`.

## Which to install

| Target                           | Install                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Web / Node wallet or dApp        | `@algorandfoundation/passkeys` (+ `@algorandfoundation/passkeys-connections-extension` to share over sessions) |
| React Native wallet              | `@algorandfoundation/react-native-passkeys` (+ the connections bridge as an optional peer)                     |
| Wallet deriving its own passkeys | add `@algorandfoundation/passkeys-keystore-extension` next to a keystore extension                             |
| Standalone store, no Provider    | `@algorandfoundation/passkeys-core` only                                                                       |

## Related Domains

- [Keystore](../keystore): supplies the derived P256 domain keys the keystore bridge converts into passkey records.
- [Connections](../connections): discovers `provider.passkey.remote` to mirror a peer's passkey metadata for a session.
- [Observability / Logs](../logs): the store and feeders log reconcile results and sync failures through `provider.log` when mounted.
