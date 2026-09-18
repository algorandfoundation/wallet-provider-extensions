# @algorandfoundation/passkeys-core

Platform-neutral **passkey inventory store** for Wallet Provider Extensions: a
reactive store of the wallet's passkey records, plus pure
server-reconciliation helpers.

A [`Passkey`](./src/types.ts) is the wallet-visible **public record** of one
credential; it is enough to render an inventory ("which passkeys does this
wallet hold, for which relying parties, and does the server still know them?")
and nothing more. **Private key material never crosses into this store**: the
optional `publicKey` field is public material only; secrets stay inside their
backing keystore or the native credential provider, and feeders must strip
every private field before a record enters the store.

Mirroring the accounts-core architecture, the package ships **pure store
functions** (`addPasskey`, `removePasskey`, `getPasskey`, `getPasskeys`,
`clearPasskeys`) over a reactive
[@tanstack/store](https://tanstack.com/store) `Store<PasskeysState>`: the store
is the single seam. **Feeders** write into it: the keystore bridge
(`@algorandfoundation/passkeys-keystore-extension`) mirrors keystore-derived
credential keys, the native feeder (`@algorandfoundation/react-native-passkeys`)
syncs the device's credential provider, and the remote mirror feeds a connected
peer's records. The functions run standalone; the package also ships
first-class support for the Algorand Wallet Provider via the `WithPasskeys`
extension.

## Package Map

| Package                                              | Role                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@algorandfoundation/passkeys`                       | Meta package owning the unified `WithPasskeys` (core store + lazily loaded connections bridge). |
| `@algorandfoundation/passkeys-core`                  | This package: types, pure store functions, reconcile helpers, and the `WithPasskeys` extension. |
| `@algorandfoundation/passkeys-keystore-extension`    | Bridge that mirrors keystore-derived P256 domain keys into the passkeys store.                  |
| `@algorandfoundation/passkeys-connections-extension` | Bridge that mounts the session-scoped remote mirror at `provider.passkey.remote`.               |
| `@algorandfoundation/react-native-passkeys`          | React Native feeder backed by the native passkey autofill module.                               |

## Installation

```bash
pnpm add @algorandfoundation/passkeys-core @tanstack/store before-after-hook
```

`@tanstack/store` (the reactive store) and `before-after-hook` (the store API's
hooks) are required peer dependencies. `@algorandfoundation/logs` is an
**optional** peer dependency; when the provider carries the `WithLogs`
extension (or a logger is injected via `options.passkeys.log`), reconciliation
results are logged through it; without it the store simply stays silent.

## Quick Start (standalone)

The store functions run on their own, so no Provider is required:

```typescript
import { Store } from "@tanstack/store";
import { addPasskey, getPasskeys, removePasskey } from "@algorandfoundation/passkeys-core";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";

const store = new Store<PasskeysState>({ passkeys: [] });

addPasskey({ store, passkey: { credentialId: "q2Zt...", rpId: "example.com" } });
const passkeys = getPasskeys({ store });
removePasskey({ store, credentialId: "q2Zt..." });
```

## Quick Start (with a Provider)

The same functions ship first-class support for the Algorand Wallet Provider
via the `WithPasskeys` extension, which mounts them (with
[before-after-hook](https://github.com/gr2m/before-after-hook) hooks) at
`provider.passkey.store`:

```typescript
import { WithPasskeys } from "@algorandfoundation/passkeys-core";
import { WithLogs } from "@algorandfoundation/logs";
import { Provider } from "@algorandfoundation/wallet-provider";

class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithLogs, WithPasskeys] as const;
}

const provider = new MyProvider(config, { passkeys: {} });

// Write and read through the store API.
await provider.passkey.store.addPasskey({ credentialId: "q2Zt...", rpId: "example.com" });
console.log(provider.passkeys); // reactive inventory

// Reconcile against the server's WebAuthn request options.
const { known, strays, missing } = await provider.passkey.store.reconcile({
  rpId: "example.com",
  allowCredentials: [{ id: "q2Zt..." }],
});
```

Without an injected store (`options.passkeys.store`) an empty in-memory store
is created and nothing survives a restart. Feeders (the keystore bridge, the
react-native native feeder) write into the same store instance, so pass one
shared `Store<PasskeysState>` when composing them.

## Configuration

`WithPasskeys` reads the `options.passkeys` namespace (`PasskeysNamespace`),
registered on the shared `ExtensionOptions` registry so it is typed at the
composition root. Bridge and platform packages **augment** the same interface
(`declare module "@algorandfoundation/passkeys-core" { interface PasskeysNamespace { … } }`),
so one `options.passkeys` block carries every installed feeder's settings:

| Option                           | Type                        | Default              | Registered by                                     | Description                                                                           |
| -------------------------------- | --------------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `passkeys.store`                 | `Store<PasskeysState>`      | fresh empty store    | `@algorandfoundation/passkeys-core`               | The reactive store; pass one shared instance so feeders and the UI see the same list. |
| `passkeys.hooks`                 | `HookCollection<any>`       | fresh collection     | `@algorandfoundation/passkeys-core`               | `before-after-hook` collection wrapping `add`/`remove`/`get`/`list`/`clear`.          |
| `passkeys.log`                   | `LogStoreApi`               | `provider.log`       | `@algorandfoundation/passkeys-core`               | Logger override for reconcile reports.                                                |
| `passkeys.keystore.autoPopulate` | `boolean`                   | `true`               | `@algorandfoundation/passkeys-keystore-extension` | Mirror the keystore's derived P256 domain keys into the store.                        |
| `passkeys.module`                | `PasskeyAutofillModuleLike` | lazily resolved peer | `@algorandfoundation/react-native-passkeys`       | The native autofill module the React Native feeder syncs from.                        |

`@algorandfoundation/passkeys-connections-extension` and the meta package read
`passkeys.store` only and register no fields of their own.

## Core Components

- [**`Passkey`**](./src/types.ts): The public record of one passkey: credential id, display `name`, optional `publicKey` (public material only) and `algorithm`, relying party, user name/handle, timestamps, derivation lineage (`parentKeyId`, `derivationVersion`, `derivationScheme`), the last reconciliation verdict (`serverStatus`, `reconciledAt`), and feeder-specific `metadata`. Deliberately contains **no private key material**.
- [**Store functions**](./src/store.ts): `addPasskey` (upsert by `credentialId`), `removePasskey`, `getPasskey`, `getPasskeys`, and `clearPasskeys`; pure functions over `Store<PasskeysState>`, the only writers.
- [**`WithPasskeys`**](./src/extension.ts): The Wallet Provider Extension; it mounts the reactive list at `provider.passkeys` and the store API (with `hooks`) at `provider.passkey.store`. The logger defaults to `provider.log` when mounted.
- [**`reconcilePasskeys`** / **`normalizeCredentialId`**](./src/reconcile.ts): Pure reconciliation helpers (see below).

## Server Reconciliation

The relying party's server is the truth for which credentials it still knows:
its `allowCredentials` list in the WebAuthn request options.
`provider.passkey.store.reconcile` compares the store's inventory against a
[`WebAuthnRequestOptionsLike`](./src/types.ts) (credential ids may be base64url
strings or raw bytes; both are normalized via
[`normalizeCredentialId`](./src/reconcile.ts)) and writes the verdicts back to
the state:

- In-scope passkeys the server listed become `serverStatus: "known"`.
- In-scope passkeys the server did **not** list become `serverStatus: "unknown"`, which identifies local **strays**.
- Ids in `allowCredentials` with no local match are returned in `missing`, representing credentials the server expects but this wallet does not hold.

A passkey is **in scope** when `options.rpId` is absent or it matches
`passkey.rpId` (or the host of `passkey.origin`); out-of-scope passkeys pass
through untouched.

```typescript
const { passkeys, known, strays, missing } = await provider.passkey.store.reconcile(serverOptions);
```

## Remote Mirror

The session-scoped remote mirror (`remotePasskeysMirror`) lives in
[`@algorandfoundation/passkeys-connections-extension`](../connections-extension):
its `WithPasskeysConnections` extension mounts it at
`provider.passkey.remote` over the same shared store, the seam connection
engines discover to exchange passkey metadata.

## Security

The store is designed to be **UI-safe**. `PasskeysState` only holds public
credential records; private key material must never enter a `Passkey`. Feeders
are the trust boundary and must drop every private field before a record
crosses into the store.

## License

Apache-2.0
