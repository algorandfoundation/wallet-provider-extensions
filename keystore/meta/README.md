# @algorandfoundation/keystore

The recommended install for the Wallet Provider Keystore, a safe place to
create, store, and use secret keys.

The keystore **generates keys** (seeds, HD-derived Ed25519 accounts,
post-quantum Falcon-1024 keys, passkey-style keys), **seals the secret material
away** in platform-appropriate storage, and
**uses keys on your behalf** (sign, verify, encrypt, decrypt) so private
material never crosses into your application code. A reactive store mirrors
only UI-safe metadata, so your app can always render the current list of keys.

This package contains **no implementation** of its own: it is a thin meta
package whose `exports` map resolves to the correct platform package for your
runtime (see [Platform resolution](#platform-resolution)). You install one
package and write the same code everywhere.

## Installation

```bash
pnpm add @algorandfoundation/keystore @tanstack/store
```

[`@tanstack/store`](https://tanstack.com/store) is a required peer dependency,
the reactive store that mirrors UI-safe key metadata.
`@algorandfoundation/logs` is an **optional** peer: when its `WithLogs`
extension is mounted on a provider, keystore operations are logged through
`provider.log`.

## Quick start (standalone)

Every platform package ships a standalone storage engine that fulfills the same
`KeyStoreAPI` contract, so no Provider is required. In Node the import below
resolves to `createNodeKeyStore` (OS keychain); in the browser the same package
exposes `createWebKeyStore` (IndexedDB):

```typescript
import { Store } from "@tanstack/store";
import { createNodeKeyStore } from "@algorandfoundation/keystore";

const store = new Store({ keys: [], status: "idle" });
const keystore = createNodeKeyStore({ store });
await keystore.ready;

// Turn a recovery-phrase seed into a root key, derive an account, sign.
const seedId = await keystore.importSeed(seedBytes, { name: "Wallet Seed" });
const rootId = await keystore.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
  params: { parentKeyId: seedId },
});
const accountId = await keystore.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");

const message = new TextEncoder().encode("hello");
const signature = await keystore.sign(accountId, message);
const ok = await keystore.verify(accountId, message, signature); // true

// Post-quantum keys are first-class: the same seed backs a Falcon-1024 key,
// signed and verified through the very same calls.
const falconId = await keystore.generate({
  type: "falcon-1024",
  algorithm: "Falcon-1024",
  extractable: false,
  keyUsages: ["sign", "verify"],
  params: { parentKeyId: seedId },
});
const pqSignature = await keystore.sign(falconId, message);
```

Every supported algorithm add-on (BIP32-Ed25519, Falcon-1024,
Deterministic-P256, BIP39 and Algo25) is enabled by default when its supporting
library is installed, so the common case needs zero wiring.

## Quick start (with a Provider)

The keystore also has first-class support for the Algorand Wallet Provider:
each platform package exports a `WithKeyStore` extension that mounts the same
API at `provider.key.store`:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

const store = new Store({ keys: [], status: "idle" });
const hooks = new Hook.Collection();

const WalletProvider = Provider.withExtensions([WithKeyStore]);
const provider = new WalletProvider(
  { id: "my-wallet", name: "My Wallet" },
  { keystore: { store, hooks } },
);

await provider.key.store.ready;
const id = await provider.key.store.generate({
  type: "ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign", "verify"],
});
const signature = await provider.key.store.sign(id, new TextEncoder().encode("hi"));
```

The Provider is a convenience, not a requirement; both entry points drive the
same engine, and other extensions (accounts, identities, passkeys) can discover
the keystore when it is mounted on a provider.

## Platform resolution

The `exports` map uses runtime/bundler conditions to pick the implementation:

| Condition        | Resolves to                                 | Storage engine                            |
| ---------------- | ------------------------------------------- | ----------------------------------------- |
| `node` / default | `@algorandfoundation/keystore-node`         | `createNodeKeyStore` (OS keychain)        |
| `browser`        | `@algorandfoundation/keystore-web`          | `createWebKeyStore` (IndexedDB)           |
| `react-native`   | `@algorandfoundation/react-native-keystore` | Device keychain with biometric protection |

All platform packages re-export
[`@algorandfoundation/keystore-core`](../core/README.md), so the shared types,
errors, encoding and reactive-store helpers are always available regardless of
the resolved condition.

### The React Native exception

React Native apps are better served by depending on
[`@algorandfoundation/react-native-keystore`](../react-native/README.md)
**directly** instead of this meta package: it exposes the same surface this
package resolves to under the `react-native` condition, without dragging the
wasm-backed web build into the install's dependency tree. Its `WithKeyStore`
extension adds biometric-backed storage options specific to mobile.

## Learn more

- [Keys](../README.md), the plain-language tour of the whole keystore domain.
- Platform packages: [`keystore-core`](../core/README.md),
  [`keystore-node`](../node/README.md), [`keystore-web`](../web/README.md),
  [`react-native-keystore`](../react-native/README.md).
- [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/keystore/meta/)
  for the full API reference.

## License

Apache-2.0
