# @algorandfoundation/react-native-keystore

A secure key management system for the Algorand Wallet Provider. Manage cryptographic keys, derive HD wallets from BIP39 seeds, and sign arbitrary data—all while keeping private keys locked away in a secure vault.

## Why This Exists

Building a non-custodial wallet requires a **secure, isolated key vault**. The Keystore Extension separates key management from wallet logic:

- **Users** enter a BIP39 mnemonic
- **Wallet UI** requests signatures without ever seeing the seed or private keys
- **Keystore backend** handles all cryptographic operations securely
- **Keys are cleared from memory** immediately after use, never staying in memory
- **Every operation is audited** for compliance and security forensics

This architecture enables:

- ✅ Non-custodial key management (users control keys)
- ✅ Multi-account support from a single seed (Algorand's `m/44'/283'/account'/change/index`)
- ✅ Ed25519 signing for Algorand
- ✅ Standalone Ed25519 keys derived directly from a seed
- ✅ XHD-derived P-256 keys (e.g. for passkeys / WebAuthn)

## Supported Algorithms & Key Types

The React Native backend implements a subset of the [`KeyType`](../store/src/types/core.ts) / [`Algorithm`](../store/src/types/core.ts) unions defined by `@algorandfoundation/keystore`:

| Type                 | Algorithm     | Description                                                                                                  |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `seed`               | `raw`         | BIP39 (24‑word) or Algo25 (25‑word) seed material; root of HD derivation                                     |
| `hd-seed`            | `raw`         | **Deprecated** alias of `seed`, kept for backward compatibility                                              |
| `hd-root-key`        | `EdDSA`       | XHD root key derived from a `seed` — required parent for `hd-derived-ed25519`                                |
| `hd-derived-ed25519` | `EdDSA`       | XHD-derived Ed25519 child key (Algorand path `m/44'/283'/account'/change/index`)                             |
| `hd-derived-p256`    | `P256`        | XHD-derived P-256 child key (passkey / WebAuthn flows)                                                       |
| `ed25519`            | `EdDSA`       | Standalone Ed25519 key derived directly from a `seed` parent (no XHD root required)                          |
| `falcon-1024`        | `Falcon-1024` | Post-quantum lattice signature key, backed by the **native** `@joe-p/react-native-falcon` module (see below) |

> `ed25519` and `hd-derived-*` keys both require a seed parent supplied via `params.parentKeyId`. Convert any BIP39 mnemonic to seed bytes before calling `importSeed`, then use the resulting seed ID when calling `generate`. `RS256` / generic `ecc` / `secret-key` types from the core union are not currently implemented in this backend.

## Quick Start

### 1. Initialize the Keystore

The keystore is typically used as an extension for the Algorand Wallet Provider.

```typescript
import { WithKeyStore } from "@algorandfoundation/react-native-keystore";
import { Provider } from "@algorandfoundation/wallet-provider";
import { keyStore } from "./stores/keystore";
import { keyStoreHooks } from "./stores/hooks";

// Use the concrete provider pattern
class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithKeyStore] as const;
}

const provider = new MyProvider(
  {
    id: "my-app",
    name: "My Application",
  },
  {
    keystore: {
      extension: {
        store: keyStore,
        hooks: keyStoreHooks,
      },
    },
  },
);
```

### 2. Generate a Key

```typescript
const keyId = await provider.keystore.generate({
  type: "hd-derived-ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign"],
  params: {
    parentKeyId: seedId,
    account: 0,
    index: 0,
  },
});

console.log(keyId); // "abc-123..."
```

### 3. Sign Arbitrary Data

```typescript
const data = new Uint8Array([1, 2, 3, ...]);

const signature = await provider.keystore.sign(keyId, data);
// Private key never exposed — signature is returned directly
```

### 4. Convert a BIP39 Mnemonic to Seed Bytes and Import It

```typescript
import { mnemonicToSeed } from "@scure/bip39";

// User provides their BIP39 mnemonic
const mnemonic = "abandon abandon abandon ... about";

// Convert the BIP39 mnemonic outside the keystore so the mnemonic string never enters it
const seed = await mnemonicToSeed(mnemonic);

const seedId = await provider.keystore.importSeed(seed);
// Seed bytes are securely stored; the BIP39 mnemonic itself is not passed to the keystore
```

### 5. Derive Multiple Accounts

```typescript
// Derive account 0
const account0 = await provider.keystore.deriveFromSeed(
  seedId,
  "m/44'/283'/0'/0/0", // Algorand path
);

// Derive account 1
const account1 = await provider.keystore.deriveFromSeed(seedId, "m/44'/283'/0'/0/1");

// Sign with any account — keys are isolated
const sig0 = await provider.keystore.sign(account0, data);
const sig1 = await provider.keystore.sign(account1, data);
```

## API Overview

### Core Operations

```typescript
// Generate a new key
const keyId = await provider.keystore.generate(options);

// Import a key or raw seed bytes
const keyId = await provider.keystore.import(keyData, format);
const seedBytes = await mnemonicToSeed(mnemonic);
const seedId = await provider.keystore.importSeed(seedBytes);

// Export public key (private key never exported)
const keyData = await provider.keystore.export(keyId);

// Sign and verify
const signature = await provider.keystore.sign(keyId, data);
const isValid = await provider.keystore.verify(keyId, data, signature);

// HD Wallet derivation
const derivedKeyId = await provider.keystore.deriveFromSeed(seedId, "m/44'/283'/0'/0/0");

// List and manage keys
const allKeys = provider.keys;
const status = provider.status;
await provider.keystore.remove(keyId);
await provider.keystore.clear();
```

## Shared-Engine Storage Driver (`createReactNativeKeyStore`)

Alongside the provider extension above, this package now exposes a
`KeyStoreDriver`-based engine that plugs into the shared, platform-neutral
`createKeyStore` orchestrator in `@algorandfoundation/keystore-core`. This is
the same engine the browser (`withIndexDB`) uses — only the persistence
("material custodian") differs per platform.

Because MMKV cannot hold a live `CryptoKey`, the mobile driver is byte-only
(`capabilities.nativeCryptoKey === false`): every secret is serialized, sealed
with a Keychain-backed AES-256-GCM master key and stored **encrypted at rest**
in MMKV; only UI-safe metadata is mirrored into the reactive store. Because
unlocking can require a biometric/passcode prompt, the engine is generic over a
per-operation context (`capabilities.interactiveUnlock === true`,
`Ctx = AuthenticationOptions`) that is threaded straight into the master-key
read — so a prompt is raised exactly when a secret is actually needed. `verify`
stays context-free — it only touches the public key and never unlocks.

```typescript
import { createReactNativeKeyStore } from "@algorandfoundation/react-native-keystore";
import { Store } from "@tanstack/store";
import { subtle } from "react-native-quick-crypto";
import { fromSeed, XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";

const store = new Store({ keys: [], status: "idle" });
const api = new XHDWalletAPI();
const keystore = createReactNativeKeyStore({
  store,
  subtle,
  xhd: {
    fromSeed: (seed) => fromSeed(Buffer.from(seed)),
    deriveKey: (r, p, isPriv, d) => api.deriveKey(r, p, isPriv, d),
    rawSign: (r, p, data, d) => (api as any).rawSign(r, p, data, d),
    verifyWithPublicKey: (sig, msg, pk) => api.verifyWithPublicKey(sig, msg, pk),
  },
});
await keystore.ready;

const seedId = await keystore.importSeed(seedBytes);
const rootId = await keystore.generate(
  {
    type: "hd-root-key",
    algorithm: "raw",
    extractable: false,
    keyUsages: ["sign"],
    params: { parentKeyId: seedId },
  },
  { biometrics: true }, // per-operation AuthenticationOptions context
);
const acctId = await keystore.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");
const sig = await keystore.sign(acctId, data, undefined, { biometrics: true });
```

The `createKeychainDriver` factory is also exported directly; it takes injected
MMKV-style storage and encrypt-at-rest primitives so the driver logic stays free
of a hard dependency on the native libraries (and is unit-testable with
in-memory fakes).

### Authentication options

`AuthenticationOptions` is both the **app-wide policy** (passed once as
`authentication` to `createReactNativeKeyStore`, or as `keystore.authentication`
on the provider extension) and the **per-operation context** (the last, optional
argument of every material-touching call). Per-call values win over the app-wide
ones, and the object you pass is never mutated.

```typescript
const keystore = createReactNativeKeyStore({
  store,
  subtle,
  authentication: {
    biometrics: true,
    // Catch-all wording.
    prompt: "Unlock your wallet",
    // Per-operation wording, configured once.
    prompts: {
      sign: "Authenticate to sign this transaction",
      export: "Authenticate to reveal your key",
    },
    // Formatter: can name the key involved. Return undefined to fall through.
    resolvePrompt: ({ operation, key }) =>
      operation === "sign" && key?.metadata?.name ? `Sign with ${key.metadata.name}` : undefined,
    // OS-level reuse window in seconds (requires the patched library, see below).
    authenticationValidityDuration: 30,
  },
});

// A per-call prompt beats everything above, for this call only.
await keystore.sign(id, data, undefined, { prompt: "Approve this payment" });
```

**Prompt precedence**, highest first:

1. `prompt` passed in the per-call context;
2. `resolvePrompt({ operation, keyId, key })`, unless it returns `undefined`;
3. `prompts[operation]`;
4. the app-wide `prompt`;
5. a short built-in sentence for the operation (e.g. `"Authenticate to sign"`).

A bare string is shorthand for `{ title }`. The engine tags every call with its
`operation` (`"generate" | "import" | "importSeed" | "export" | "sign" |
"batchSign" | "deriveFromSeed" | "deriveDomainKey" | "deriveSharedSecret" |
"encryptWithKey" | "decryptWithKey" | "remove" | "clear" | "secret.put" |
"secret.get" | "secret.remove"`) and, where the call targets one key, its
`keyId`; the `key` handed to the formatter is the **metadata** already in the
reactive store — nothing is ever decrypted to build a prompt. `verify` is not
tagged: it never unlocks.

#### `authenticationValidityDuration` (unlock reuse window)

The master key is **never cached in JS memory** — it is read, used and wiped per
operation. To avoid prompting on every operation, use the platform's own
post-unlock reuse window instead, which never exposes the key bytes:

- **Android**: the value is baked into the Keystore key when the master-key item
  is **created** (`setUserAuthenticationValidityDurationSeconds`, default 5s).
  Changing it later has no effect on an existing item — that item must be
  deleted and recreated.
- **iOS**: applied per read as an `LAContext` reuse duration, so it can be
  changed freely between reads.

This option requires the patched `react-native-keychain@10.0.0` (see
`patches/react-native-keychain@10.0.0.patch`), which adds the JS option to
`getGenericPassword`/`setGenericPassword`. Without the patch the value is
ignored by the native side.

#### `invalidateOnEnrollment` (strict biometric policy, opt-in)

By default the master-key item is stored with
`ACCESS_CONTROL.BIOMETRY_ANY`: any biometric currently enrolled can unlock it,
which means an attacker who can enrol a new fingerprint on an unlocked device
can also unlock the vault. Setting `invalidateOnEnrollment: true` stores it with
`ACCESS_CONTROL.BIOMETRY_CURRENT_SET`, binding it to the biometric set enrolled
at that moment.

> ⚠️ **With the strict policy, any biometric change destroys the master key.**
> Adding a finger or re-enrolling Face ID — even legitimately, by the real user
> — permanently invalidates the stored item. Every sealed record becomes
> unreadable and the wallet can only be recovered **from the seed phrase**. Only
> enable this for users you know hold a backup.

> ℹ️ The flag only takes effect when the master-key item is **created**. An
> existing entry keeps whatever policy it was created with, so turning the flag
> on (or off) in an already-installed app changes nothing until that entry is
> removed and recreated.

### Post-quantum Falcon-1024 (native, not WASM)

Every other platform enables Falcon-1024 through the WASM `falcon-1024` module,
but **older React Native runtimes cannot load WASM**. This package therefore
adapts the native
[`@joe-p/react-native-falcon`](https://github.com/joe-p/react-native-falcon)
module (a Nitro HybridObject with an Android/iOS C++ backend) onto the core
`Falcon1024Binding` via `createFalconBinding`.

When you create the engine without an explicit `shims` array, it enables the
full default shim set and folds Falcon-1024 in automatically: it uses the
`falcon` binding you pass, or otherwise lazily loads `@joe-p/react-native-falcon`
(`loadDefaultFalconBinding`) when the module is installed — and simply leaves
Falcon out of the default set when it is not, without throwing.

```typescript
import { FalconModule } from "@joe-p/react-native-falcon";
import {
  createFalconBinding,
  createReactNativeKeyStore,
} from "@algorandfoundation/react-native-keystore";
import { subtle } from "react-native-quick-crypto";

const keystore = createReactNativeKeyStore({
  store,
  subtle,
  // Inject the native Falcon module; omit this to auto-load @joe-p/react-native-falcon.
  falcon: createFalconBinding(FalconModule),
});
await keystore.ready;

const id = await keystore.generate({
  type: "falcon-1024",
  algorithm: "Falcon-1024",
  extractable: false,
  keyUsages: ["sign", "verify"],
  params: { seed: seedBytes }, // seed-derived, so the key is recoverable
});
const sig = await keystore.sign(id, data);
const ok = await keystore.verify(id, data, sig);
```

`@joe-p/react-native-falcon` is an **optional** native dependency: install and link it
in your app to use post-quantum keys. Because its `verify` throws on an invalid
signature, the adapter translates that into WebCrypto's boolean `verify`
contract; its `ArrayBuffer` surface is converted to the `Uint8Array` the core
binding expects.

## Security Properties

### Private Keys

- ✅ **Never exported** from the keystore
- ✅ **Never exposed** to the wallet UI or React state
- ✅ **Always encrypted** at rest (Stored in MMKV, encrypted with Keychain-backed master key)
- ✅ **Ephemeral in memory** — cleared immediately after use via `clearBuffer`
- ✅ **Isolated** per derivation path (multi-account support)
- ✅ **Master key is never cached in JS memory** — it is read from the Keychain,
  used and wiped per operation; prompt spam is avoided at the OS level via
  [`authenticationValidityDuration`](#authenticationvalidityduration-unlock-reuse-window)

### Seeds (BIP39)

- ✅ **BIP39 mnemonic strings stay outside** the keystore API
- ✅ **Only seed bytes are imported** into the keystore
- ✅ **Never exported** after import
- ✅ **Never shared** with wallet UI
- ✅ **Derivation happens inside** the secure backend
- ✅ **Ephemeral in memory** — seeds are cleared after derivation
- ✅ **Child keys are isolated** — deriving Account 0 doesn't expose the seed

## Architecture & Bootstrapping

For more detailed information, see:

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Design details and storage flow.
- [BOOTSTRAPPING.md](./BOOTSTRAPPING.md) — Complete integration and startup guide.

## License

Apache-2.0
