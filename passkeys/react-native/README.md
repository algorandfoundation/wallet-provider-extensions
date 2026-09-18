# @algorandfoundation/react-native-passkeys

React Native entry point for the passkeys domain: the platform-neutral passkey
store of [`@algorandfoundation/passkeys-core`](../core/README.md) (fully
re-exported), fed by the native credential provider of
`@algorandfoundation/react-native-passkey-autofill`.

The package ships the native **feeder** between the two:
[`nativePasskeysFeeder`](./src/feeder.ts) syncs the autofill module's
credentials into the passkeys store (on start and on the native lifecycle
events) and propagates store removals back to the module, and the React Native
[`WithPasskeys`](./src/extension.ts) extension composes the feeder with the
core extension. The native module is **injected** through the structural
`PasskeyAutofillModuleLike` seam (no compile-time dependency on react-native),
so this package builds and tests without native code. The feeder runs
standalone over any `Store<PasskeysState>`; it also ships first-class support
for the Algorand Wallet Provider via the `WithPasskeys` extension.

## Why This Exists

A wallet that acts as the device's passkey credential provider needs a
**UI-safe inventory** of the credentials it holds, ensuring that no key
material reaches the JS layer:

- **The native module** (Keychain / MMKV) owns the credentials and their secrets.
- **`toPasskey`** is the trust boundary: it maps a native credential identity to the public `Passkey` shape, **dropping every key-material field** (`privateKey`, `privateKeyBase64`, `publicKey`, `publicKeyBase64`) and the provider-internal `userId`.
- **The reactive store** renders the inventory: the feeder re-syncs on native `onPasskeyAdded` / `onPasskeyAuthenticated` events, and store removals of native-sourced passkeys delete the backing native credential (loop-guarded in both directions).

## Installation

```bash
pnpm add @algorandfoundation/react-native-passkeys @algorandfoundation/passkeys-core @tanstack/store
```

Required peer dependencies: `@algorandfoundation/passkeys-core` (the
platform-neutral store this package wraps and re-exports) and `@tanstack/store`
(the reactive store backing it).

Optional peer dependencies:

- `@algorandfoundation/react-native-passkey-autofill`, which is the native credential provider module. When installed, the extension lazily resolves its default export; otherwise pass the module via `passkeys.module`.
- `@algorandfoundation/logs`: when the provider carries the `WithLogs` extension (or a logger is injected via `passkeys.log`), sync failures and reconciliation results are logged through it.

## Quick Start (standalone)

The feeder runs on its own, so no Provider is required. Hand it a store and the
native module:

```typescript
import { Store } from "@tanstack/store";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";
import { nativePasskeysFeeder } from "@algorandfoundation/react-native-passkeys";
import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";

const store = new Store<PasskeysState>({ passkeys: [] });
const feeder = nativePasskeysFeeder({ module: PasskeyAutofill, store });
await feeder.ready;
console.log(store.state.passkeys);
```

## Quick Start (with a Provider)

The same feeder ships first-class support for the Algorand Wallet Provider via
the `WithPasskeys` extension, which composes it with the core extension:

```typescript
import { WithPasskeys } from "@algorandfoundation/react-native-passkeys";
import { WithLogs } from "@algorandfoundation/logs";
import { Provider } from "@algorandfoundation/wallet-provider";
import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";

// Use the concrete provider pattern
class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithLogs, WithPasskeys] as const;
}

const provider = new MyProvider(config, {
  passkeys: { module: PasskeyAutofill },
});

// Wait for the initial native sync to complete.
await provider.passkey.ready;

// Reactive inventory of the passkeys the credential provider holds.
console.log(provider.passkeys);

// Is this app the device's active credential provider?
const active = await provider.passkey.providerActive();
if (!active) await provider.passkey.openProviderSettings();

// Reconcile against the server's WebAuthn request options.
const { strays, missing } = await provider.passkey.store.reconcile(serverOptions);
```

When `passkeys.module` is omitted the extension lazily resolves the default
export of `@algorandfoundation/react-native-passkey-autofill` (when the
optional peer is installed and a CJS `require` exists in the host runtime, and
Metro provides one) and throws otherwise, so misconfiguration fails loudly at
setup rather than silently at first use.

## Configuration

`WithPasskeys` reads the shared `options.passkeys` namespace
(`PasskeysNamespace`, registered on the `ExtensionOptions` registry by
`@algorandfoundation/passkeys-core`) and **augments** it with the native
`module`, so the whole block is typed at the composition root
(`ReactNativePasskeysOptions` is the same `PasskeysOptions` shape):

| Option                           | Type                        | Default              | Registered by                                     | Description                                                                                 |
| -------------------------------- | --------------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `passkeys.module`                | `PasskeyAutofillModuleLike` | lazily resolved peer | `@algorandfoundation/react-native-passkeys`       | The native autofill module the feeder syncs from; throws when neither is resolvable.        |
| `passkeys.store`                 | `Store<PasskeysState>`      | fresh empty store    | `@algorandfoundation/passkeys-core`               | The reactive store; pass one shared instance so other feeders and the UI see the same list. |
| `passkeys.hooks`                 | `HookCollection<any>`       | fresh collection     | `@algorandfoundation/passkeys-core`               | `before-after-hook` collection wrapping the store API.                                      |
| `passkeys.log`                   | `LogStoreApi`               | `provider.log`       | `@algorandfoundation/passkeys-core`               | Logger override for sync warnings and reconcile reports.                                    |
| `passkeys.keystore.autoPopulate` | `boolean`                   | `true`               | `@algorandfoundation/passkeys-keystore-extension` | Only when the keystore bridge is also mounted (`WithPasskeysKeystore`).                     |

## Key API

Everything from `@algorandfoundation/passkeys-core` is re-exported (the
`Passkey` type, the store functions, `reconcilePasskeys`, …). On top of
that this package adds:

- [**`WithPasskeys`**](./src/extension.ts): The React Native Wallet Provider Extension: the core `WithPasskeys` composed with the native feeder, plus the platform surface `provider.passkey.ready` / `refresh()` / `providerActive()` / `openProviderSettings()`. Accepts the shared `options.passkeys` namespace, which this package augments with `passkeys.module` ([`ReactNativePasskeysOptions`](./src/extension.ts)). The connections bridge is loaded lazily to attach `provider.passkey.remote`; `provider.passkey.store.ready` settles once that import did.
- [**`nativePasskeysFeeder`**](./src/feeder.ts): Syncs `getStoredCredentials()` into the store on start and on both native events, removes records the module no longer reports, and observes the store to propagate removals of native-sourced passkeys to `deleteCredential`; both directions are loop-guarded through the feeder's credential-id snapshot.
- [**`toPasskey`**](./src/feeder.ts): The trust-boundary mapper from a native [`PasskeyAutofillCredentialIdentityLike`](./src/feeder.ts) to the public `Passkey`, which normalizes `relyingPartyIdentifier`/`rpId` to `rpId` and `userName`/`name` to `userName`, and drops all key material.
- [**`defaultPasskeyAutofillModule`**](./src/feeder.ts): Lazily resolves the native module from the optional peer, or `undefined` when it is not resolvable.
- [**`PasskeyAutofillModuleLike`**](./src/feeder.ts): The structural subset of the native module's surface this feeder consumes, so tests can inject doubles that fulfill it.

## Security

Key material never crosses into the JS store. The native credential provider
owns the secrets; `toPasskey` strips every key field before a record enters the
reactive state, so `provider.passkeys` is safe to bind directly to UI.

## License

Apache-2.0
