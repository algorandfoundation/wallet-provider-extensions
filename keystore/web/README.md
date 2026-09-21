# @algorandfoundation/keystore-web

The browser entry point for the Wallet Provider Keystore.

The shared cryptographic implementation (the composable Subtle shims and the
platform-neutral `createKeyStore` engine) lives in
[`@algorandfoundation/keystore-core`](../core/README.md), relies exclusively on
the universal `globalThis.crypto` (`crypto.subtle` / `crypto.getRandomValues`)
and pure-JS primitives, so it runs unchanged in the browser and is re-exported
here.

Most applications should depend on the meta package
[`@algorandfoundation/keystore`](../meta/README.md), which selects this package
automatically via the `browser` export condition.

## IndexedDB storage engine

This package ships `createWebKeyStore` — the browser `withIndexDB` storage
engine. It implements the platform-neutral `KeyStoreAPI` on top of the core
composable Subtle shims (`withSubtleXHD` / `withSubtleFalcon1024`):

- **Standard host keys** (Ed25519, ECDSA, AES, …) are persisted as
  **non-extractable `CryptoKey`s**, structured-cloned into IndexedDB, so their
  private bytes never exist as exportable material in JS. (Supplying your own
  master key, below, seals these as bytes instead.)
- **Shim key material** (BIP32-Ed25519 roots, Falcon private keys) and **raw
  seeds** cannot be structured-cloned, so they are stored as bytes **encrypted
  at rest** with a non-extractable AES-GCM master key (itself a `CryptoKey`
  persisted in IndexedDB).
- The reactive [`@tanstack/store`](https://tanstack.com/store) holds **only
  UI-safe metadata** — never private material. Secrets are decrypted
  just-in-time and injected into the shim algorithm parameters for a single
  operation, then wiped.

Every supported algorithm add-on (BIP32-Ed25519, Falcon-1024,
Deterministic-P256, BIP39 and Algo25) is **enabled by default** via core's
`createDefaultShims`, so no wiring is needed for the common case. Pass an
explicit `shims` array to narrow the set or swap in platform-native bindings.

```typescript
import { Store } from "@tanstack/store";
import { createWebKeyStore } from "@algorandfoundation/keystore-web";

const store = new Store({ keys: [], status: "idle" });

// All shims on by default — no bindings to wire up.
const keystore = createWebKeyStore({ store });
await keystore.ready;

const seedId = await keystore.importSeed(bip39Seed);
const rootId = await keystore.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["sign"],
  params: { parentKeyId: seedId },
});
const acctId = await keystore.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");
const signature = await keystore.sign(acctId, new TextEncoder().encode("hi"));
const ok = await keystore.verify(acctId, message, signature);
```

### Supplying your own master key

By default the vault mints its AES-GCM master key itself and keeps it in the
same database as the material it seals, which makes a copy of the profile
directory enough to open that material. Pass a `masterKey` provider to bind it
to a secret the browser cannot produce on its own instead — one derived from a
user password, or held by another context:

```typescript
const keystore = createWebKeyStore({ store, masterKey: () => unlockedKey() });
```

The provider is called for every operation that seals or opens byte material,
never captured, so it may reject while the vault is locked and resolve once it
is open. With one set the vault mints no master key of its own, and the driver
reports `nativeCryptoKey: false` so that keys which would otherwise persist as
non-extractable `CryptoKey`s are sealed with the supplied key as well.

Two limits are worth knowing before you reach for it:

- **It is not a migration.** Byte material the default vault already sealed —
  seeds, HD roots, Falcon keys — **stops opening** once a provider is set:
  `use()` asks the provider for a key that did not seal it and AES-GCM
  rejects. It cannot be re-imported either, because it can no longer be read.
  Migrate such a database by reading that material out under the default
  driver and re-writing it under the provider before switching, or the user
  re-imports from their recovery phrase. Records written natively as
  `CryptoKey`s are unaffected and keep working — which is its own caveat,
  since they were never sealed and stay openable from a profile copy.
- Sealing standard keys instead of storing them natively means their bytes are
  decrypted into JS memory for each use, where a `CryptoKey` never is. Core
  handles the switch transparently, but the trade is real.

It is also accepted by the `WithKeyStore` extension, under `keystore`.

## `WithKeyStore` provider extension

For the Provider/Extensions pattern this package also ships a `WithKeyStore`
extension (mirroring the React Native one). When no backend is injected via
`options.api.keystore`, it builds the browser engine from `options.keystore`
(the reactive `store`, `hooks`, and — optionally — `subtle`/`shims`/IndexedDB
seams), applies the keystore hooks at creation, and exposes the API (plus
`hooks`) on `key.store`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore-web";

const ProviderWithKeystore = Provider.withExtensions([WithKeyStore]);
const provider = new ProviderWithKeystore({ keystore: { store, hooks } });

provider.key.store.hooks.before("sign", ({ args }) => console.log("signing", args));
```

The shared core types, errors and Subtle shims are re-exported here as well;
either compose your own flow on those primitives or use `createWebKeyStore`.

## License

Apache-2.0
