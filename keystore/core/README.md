# @algorandfoundation/keystore-core

Platform-neutral **types, errors and helpers** for the Wallet Provider Keystore.

This package provides the base interfaces, error classes and the shared context
constant. It also ships the composable Subtle shims and the shared,
platform-neutral keystore engine ([`createKeyStore`](./src/create.ts)). The
shims stay binding-agnostic (core depends only on the binding _types_) and the
storage backend is always injected as a [`KeyStoreDriver`](./src/types/driver.ts).
For zero-config use, core also ships a **batteries-included default shim set**
([`createDefaultShims`](./src/defaults.ts)). The heavier crypto libraries it can
use (`@algorandfoundation/xhd-wallet-api`, `falcon-1024`,
`@algorandfoundation/dp256`) are declared as **optional peer dependencies** and
loaded lazily via dynamic `import()`, so a shim is enabled only when its library
is actually installed by a downstream package — you pay only for the algorithms
you use. BIP39 (`@scure/bip39`) and a small built-in Algo25 mnemonic
implementation ([`createAlgo25Binding`](./src/algo25.ts)) ship with core. The
platform packages (node / web / react-native) declare the crypto libraries they
need as real dependencies, so they stay zero-config out of the box, and add a
driver and re-export this package.

## Package Map

| Package                                     | Role                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `@algorandfoundation/keystore-core`         | This package — types, errors, shims, constants.                      |
| `@algorandfoundation/keystore-node`         | Node / server entry point (thin re-export of core).                  |
| `@algorandfoundation/keystore-web`          | Browser implementation (`withIndexDB` engine; re-exports core).      |
| `@algorandfoundation/react-native-keystore` | React Native `WithKeyStore` extension with biometric-backed storage. |
| `@algorandfoundation/keystore`              | Meta package — resolves to the right platform package via `exports`. |

Most applications should depend on the meta package
[`@algorandfoundation/keystore`](../meta/README.md); it resolves to the correct
platform implementation via package export conditions (`node` / `browser` /
`react-native`).

## Why This Exists

By separating the types from the implementation, we enable:

- **Environment Specific Implementations**: node / web / React Native packages that all fulfill the same contract.
- **Type Safety**: Unified interfaces for all keystore-related operations, including arbitrary data signing and HD derivation.
- **Reactive State**: UI-safe key-metadata types designed for [@tanstack/store](https://tanstack.com/store).

## Core Components

- [**`KeyStoreAPI<Ctx>`**](./src/types/backend.ts): The main interface that all backends fulfill. Generic over a per-operation **context** `Ctx` (opaque to portable callers) threaded through every material-touching method; `verify` is intentionally context-free.
- [**`createKeyStore<Ctx>`**](./src/create.ts): The shared engine that fulfills `KeyStoreAPI` by orchestrating an injected host `SubtleCrypto` (with the shims layered over it) and an injected `KeyStoreDriver`. Every platform backend builds on this instead of re-implementing the orchestration.
- [**`KeyStoreDriver<Ctx>`** / **`DriverCapabilities`** / **`DriverMaterial`**](./src/types/driver.ts): The storage-backend contract — a "material custodian" that owns encrypted-at-rest persistence, metadata and any platform-specific unlock flow.
- [**`KeyStoreState`** / **`KeyStoreExtension`**](./src/types/extension.ts): Reactive state and the interface exposed when added to a Wallet Provider.

## Shared Engine & Storage Drivers

The crypto orchestration (metadata mirroring into the reactive store,
just-in-time material decryption, shim injection, memory wiping) is written
**once** in [`createKeyStore`](./src/create.ts). A backend only implements a thin
[`KeyStoreDriver`](./src/types/driver.ts) and hands it in:

```typescript
import {
  createKeyStore,
  withSubtleXHD,
  withSubtleFalcon1024,
} from "@algorandfoundation/keystore-core";

const keystore = createKeyStore({
  driver,
  store,
  subtle,
  // Compose exactly the algorithms you need, each with its binding applied.
  shims: [(host) => withSubtleXHD(host, xhd), (host) => withSubtleFalcon1024(host, falcon)],
  hooks,
});
await keystore.ready;
```

When `shims` is omitted the engine enables the **default set**
(`createDefaultShims`, resolved asynchronously as part of `keystore.ready`) —
every supported algorithm whose library is installed, each with its bundled
binding — so the common case needs no wiring: `createKeyStore({ driver, store })`.
The optional-peer crypto libraries are loaded lazily and any that are absent are
simply skipped. Pass an explicit array (including `[]`) to narrow the set or
supply platform-native bindings.

The engine is the single source of the `KeyStoreAPI`. Beyond the core
sign/verify/generate/derive flow it also provides `encryptWithKey`/
`decryptWithKey` (host Subtle AES-GCM keyed off a key's public bytes),
`deriveSharedSecret` (the Diffie-Hellman/ECDH negotiation path — routed through
the XHD shim for HD-derived keys and host ECDH otherwise), and `clear` (when the
driver supports a bulk clear). When an optional `hooks` collection is supplied,
every material-touching method is wrapped at creation so `before`/`after`/`error`
hooks can intercept it, and the collection is exposed as `keystore.hooks` — this
is how the Wallet Provider `WithKeyStore` extension threads its hooks in.

Backends diverge along exactly two first-class axes so they can evolve without
forking the contract:

- **`capabilities.nativeCryptoKey`** — `true` when the backend can persist a
  non-extractable `CryptoKey` natively (IndexedDB structured-clone), `false`
  when standard keys must be serialized to sealed bytes (Keychain/MMKV).
- **The generic `Ctx`** — a non-interactive backend (IndexedDB) ignores it,
  while an interactive one (React Native biometrics) types it as its own
  auth-prompt/cancellation options and advertises `capabilities.interactiveUnlock`
  / `authFactors`.

This lets each platform ship a **shallow package** that supplies a driver:
`@algorandfoundation/keystore-web` provides `createIndexedDBDriver`
(`nativeCryptoKey: true`, `Ctx = void`); a React Native backend would provide a
Keychain/MMKV driver (`nativeCryptoKey: false`, `Ctx = AuthenticationOptions`).

### Composable Subtle shims

Each shim (in [`src/shims`](./src/shims)) is a decorator `withSubtleX(host, binding)`
that teaches any `SubtleCrypto` one extra algorithm and delegates everything else
to the host. Bindings are **injected** (core depends only on their types), so the
same shims run on every platform. The engine takes them as a single `shims`
array (`Array<(host: SubtleCrypto) => SubtleCrypto>`), each entry a `withSubtleX`
with its binding already applied, layered over the host in order:

| Shim                   | Algorithm            | Binding             | Purpose                                                                                         |
| ---------------------- | -------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `withSubtleXHD`        | `BIP32-Ed25519`      | `XHDBinding`        | HD (extended) Ed25519 derivation + signing + ECDH                                               |
| `withSubtleFalcon1024` | `Falcon-1024`        | `Falcon1024Binding` | Post-quantum lattice signatures                                                                 |
| `withSubtleDP256`      | `Deterministic-P256` | `DP256Binding`      | Deterministic passkey (PBKDF2 main key → domain key)                                            |
| `withSubtleBIP39`      | `BIP39`              | `BIP39Binding`      | Mnemonic seed source — `generateKey` mints recoverable **entropy**, `deriveBits` → 64-byte seed |
| `withSubtleAlgo25`     | `Algo25`             | `Algo25Binding`     | Algorand 25-word mnemonic seed (entropy == 32-byte seed)                                        |

The seed shims (`BIP39`/`Algo25`) persist the recoverable **entropy** at birth so
the mnemonic phrase can be reconstructed; the engine converts entropy → seed
just-in-time when deriving an `hd-root-key` from a `seed` whose `metadata.scheme`
is `bip39`/`algo25`. `importKey`/`exportKey` always throw — material only crosses
the surface through the read-once birth channel.

### Secrets

`keystore.secrets` is a small key/value interface ([`SecretStoreAPI`](./src/types/backend.ts))
for arbitrary application values (API tokens, opaque blobs) with no cryptographic
role. Secrets are sealed at rest through the same driver as key material, but —
unlike key material — are readable back in plaintext via `secrets.get(id)`; only
their non-secret metadata is mirrored into the reactive store.

```typescript
const id = await keystore.secrets.put("my-api-token", { name: "API Token" });
const value = await keystore.secrets.get(id); // Uint8Array plaintext
```

## API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/keystore/store/).

### Key Interfaces

- [**`KeyStoreAPI`**](./src/types/backend.ts): Main interface for cryptographic operations.
- [**`KeyStoreState`**](./src/types/extension.ts): Reactive state structure.
- [**`Key`**](./src/types/core.ts): Metadata for a single key.

## Supported Algorithms & Key Types

This package defines the canonical [`KeyType`](./src/types/core.ts) and [`Algorithm`](./src/types/core.ts) unions used by every backend. Backends are free to implement a subset of these.

### Algorithms

| Algorithm | Description                                |
| --------- | ------------------------------------------ |
| `EdDSA`   | EdDSA using Ed25519 (signing/verification) |
| `P256`    | ECDSA using P-256 and SHA-256              |
| `RS256`   | RSA PKCS#1 v1.5 with SHA-256               |
| `raw`     | Raw bytes (e.g. seed material)             |

### Key Types

| Type                 | Algorithm | Description                                                               |
| -------------------- | --------- | ------------------------------------------------------------------------- |
| `seed`               | `raw`     | BIP39 / Algo25 seed material used as a root for HD derivation             |
| `hd-seed`            | `raw`     | **Deprecated** alias of `seed`, kept for backward compatibility           |
| `hd-root-key`        | `EdDSA`   | XHD root key derived from a `seed` (basis for `hd-derived-ed25519`)       |
| `hd-derived-ed25519` | `EdDSA`   | XHD-derived Ed25519 child key (Algorand `m/44'/283'/account'/change/idx`) |
| `hd-derived-p256`    | `P256`    | XHD-derived P-256 child key                                               |
| `ed25519`            | `EdDSA`   | Standalone Ed25519 key derived directly from a `seed` parent              |
| `rsa`                | `RS256`   | RSA key pair (handed off to WebCrypto)                                    |
| `ecc`                | `P256`    | Generic elliptic-curve key pair (handed off to WebCrypto)                 |
| `secret-key`         | `raw`     | Arbitrary user-supplied symmetric/secret material                         |

> Generation of `ed25519` and `hd-derived-*` keys requires a `seed` (or legacy `hd-seed`) parent — callers convert any mnemonic to a seed before calling `generate`. Unrecognized algorithms fall through to a `SubtleCrypto` WebCrypto fallback.

## Security

The keystore types are designed to be **UI-safe**. `KeyStoreState` only holds metadata and public identifiers. Private key material should **never** be stored in the reactive store and should remain isolated within the backend implementation.

## License

Apache-2.0
