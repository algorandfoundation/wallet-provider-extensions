# The Keystore, Explained

Welcome! This is a friendly, plain-language tour of the Keystore. If you have
never seen this codebase before, start here. By the end you should understand
what the Keystore is, why it is split into several packages, and how the pieces
click together.

There are no assumptions about deep cryptography knowledge. Where a crypto term
shows up, it is explained in everyday words first.

## What is a Keystore?

A keystore is a safe place to create, store, and use secret keys.

Think of it like a keyring for a house, but for digital keys:

- It can **make new keys** (for example, the keys behind a crypto wallet).
- It **locks the secret part of each key away** so nothing else in your app can
  read it by accident.
- It can **use a key on your behalf** to do things like "sign this message"
  (prove it came from you) without ever handing out the secret itself.
- It keeps a small, safe-to-show **list of what keys exist** so your app's screen
  can display them.

The golden rule: the secret part of a key never leaves the vault. Your app asks
the keystore to "sign this" or "verify that", and only the results come back.
The secret stays inside.

## The big picture

The Keystore is not one giant program. It is a small **shared brain** plus a few
thin **adapters**, one per environment (Node.js, the browser, React Native). They
all speak the same language, so your app code looks almost identical no matter
where it runs.

Here is the mental model:

```
Your app
   |
   v
Wallet Provider  (the app-wide context)
   |
   +-- Keystore extension  (adds "key.store" to the provider)
          |
          v
     Shared engine  (the shared brain: createKeyStore)
          |
   +------+---------------------+
   |                            |
   v                            v
 Shims                       Driver
 (add crypto algorithms)     (stores the sealed secrets on disk / in the OS)
```

Two ideas do most of the work:

- A **shared engine** contains all the tricky orchestration logic, written once.
- Everything that changes between platforms is **injected** into that engine: how
  secrets are stored (the "driver") and which crypto algorithms are available
  (the "shims").

Because the smart part is shared and the platform-specific parts are plugged in,
adding a new platform means writing a small adapter, not a whole new keystore.

## The packages, one by one

The Keystore lives under `keystore/` and is split into these packages. Most apps
only ever install one of them (the meta package), but it helps to know what each
does.

| Folder          | Package name                                | What it is                                                                         |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `core/`         | `@algorandfoundation/keystore-core`         | The shared brain: types, the engine, the crypto shims, and error definitions.      |
| `node/`         | `@algorandfoundation/keystore-node`         | The Node.js / server adapter. Also ships a command line tool and an RPC service.   |
| `web/`          | `@algorandfoundation/keystore-web`          | The browser adapter (stores sealed keys in the browser's IndexedDB).               |
| `react-native/` | `@algorandfoundation/react-native-keystore` | The mobile adapter (stores keys behind the device keychain and biometrics).        |
| `meta/`         | `@algorandfoundation/keystore`              | A tiny router package that automatically picks the right adapter for your runtime. |

If you are building an app, install the **meta package**
(`@algorandfoundation/keystore`). When your code runs in Node it quietly uses the
Node adapter, in a browser it uses the web adapter, and so on. You write your code
once. (React Native is a small exception, explained later.)

If you are building a **library** that is platform neutral, or you want to
understand the internals, read the [`core` package](./core/README.md). It is
where all the interesting logic lives.

## The key concepts

This project follows a small set of building blocks used across the whole
codebase, not just the keystore. Learning them here will help you everywhere.

### Provider

A **Provider** is an app-wide context object. You create one near the start of
your app, add some capabilities to it, and then pass it around. Think of it as
the central hub that features hang off of.

### Extension

An **Extension** is a capability you bolt onto a Provider. The keystore ships one
called `WithKeyStore`. Adding it gives your provider a `key.store` object that
holds all the keystore operations.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore-web";

// Compose a provider that has keystore powers.
const WalletProvider = Provider.withExtensions([WithKeyStore]);
const provider = new WalletProvider(
  { id: "my-wallet", name: "My Wallet" },
  { keystore: { store, hooks } },
);

// Wait for the keystore to finish starting up, then use it.
await provider.key.store.ready;
```

### Store

A **Store** is the single, reactive source of truth for a slice of data. The
keystore keeps a `KeyStoreState` in a store that holds:

- `keys`: the safe-to-show list of key metadata (never any secrets).
- `status`: what the keystore is doing right now (for example `idle`).
- `algorithms`: which crypto capabilities are currently active (more on this
  below).

Because it is reactive, your UI can subscribe to it and automatically update when
a key is added or removed. Nothing secret is ever placed in the store, so it is
always safe to render.

### Hooks

**Hooks** let you run code **before** or **after** any keystore operation, or when
one **errors**, without changing the operation itself. They are great for logging,
auditing, or reacting to events.

```typescript
// Log every time a key is about to be generated.
provider.key.store.hooks.before("generate", () => {
  console.log("About to generate a key");
});
```

### Options

**Options** are how you configure things. You pass provider options (like an id
and a name) and per-extension options (like the keystore's store and hooks) when
you build the provider.

## How a key is actually made and used

Here is the everyday flow, in plain steps.

1. **Create a seed.** A seed is a chunk of random bytes that everything else is
   grown from. It usually starts life as a 24-word recovery phrase (a mnemonic).
   The keystore can turn that phrase into a seed and store it sealed away.
2. **Grow a root key from the seed.** The root key is the top of a family tree of
   keys.
3. **Derive child keys (accounts) from the root.** Each account is a separate key
   that can sign transactions, but they all trace back to the same seed. This is
   called HD (hierarchical deterministic) derivation. The benefit: one recovery
   phrase can restore every account.
4. **Sign and verify.** Ask the keystore to sign a message with a key. Anyone can
   later verify the signature using the public part of that key. The secret never
   leaves the vault.

In code this looks roughly like:

```typescript
const store = provider.key.store;

// 1 + 2: turn a recovery phrase into a seed, then a root key.
const seedId = await store.importSeed(seedBytes, { name: "Wallet Seed" });
const rootId = await store.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
  params: { parentKeyId: seedId },
});

// 3: derive an account key from the root.
const accountId = await store.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");

// 4: sign a message and verify the signature.
const message = new TextEncoder().encode("hello");
const signature = await store.sign(accountId, message);
const ok = await store.verify(accountId, message, signature); // true
```

You do not need to memorize the exact arguments. The point is the shape: you ask
`key.store` to do things by key id, and secrets stay inside.

## Shims: how algorithms are added

Browsers and Node already know some cryptography through a built-in tool called
`SubtleCrypto` (part of the Web Crypto standard). But it does not know every
algorithm this project needs, such as Algorand's HD Ed25519 derivation or the
post-quantum Falcon signatures.

A **shim** solves this. A shim is a small wrapper that takes the built-in
`SubtleCrypto`, teaches it **one** extra algorithm, and passes everything else
straight through to the original. You can stack several shims to add several
algorithms.

The shipped shims are:

| Shim                   | Algorithm            | What it adds                                        |
| ---------------------- | -------------------- | --------------------------------------------------- |
| `withSubtleXHD`        | `BIP32-Ed25519`      | Hierarchical Ed25519 key derivation and signing.    |
| `withSubtleFalcon1024` | `Falcon-1024`        | Post-quantum (quantum-resistant) signatures.        |
| `withSubtleDP256`      | `Deterministic-P256` | Deterministic passkey style keys.                   |
| `withSubtleBIP39`      | `BIP39`              | The classic 12/24-word recovery-phrase seed source. |
| `withSubtleAlgo25`     | `Algo25`             | Algorand's 25-word mnemonic seed source.            |

You almost never wire these by hand. If you do not tell the engine which shims to
use, it enables a **batteries-included default set** for you: it turns on every
algorithm whose supporting library is actually installed and quietly skips the
rest. So you only pay for what you use, and the common case needs zero
configuration.

### Seeing what is available at runtime

Because different environments have different capabilities, the keystore reports
what is actually active in its state, under `algorithms`. Each entry is tagged
with where it came from:

- `source: "host"` means the built-in `SubtleCrypto` provided it.
- `source: "shim"` means one of the shims above added it.

This is handy for a UI that wants to show "here is what this device can do".

## Drivers: how secrets are stored

The engine never decides **where** sealed secrets live. That job belongs to a
**driver**, which each platform package supplies:

- **Web** stores non-extractable keys directly in the browser's IndexedDB.
- **React Native** seals secrets behind the device keychain, often protected by
  the user's fingerprint or face unlock.
- **Node** seals material into the operating system keychain plus a sealed file.

The driver is a "material custodian". It owns the encrypted-at-rest storage and
any unlock flow (like a biometric prompt). The engine just asks the driver to
store or fetch sealed bytes when needed. This clean split is why the same engine
works everywhere.

## Secrets: not just keys

Alongside cryptographic keys, the keystore has a small `secrets` area for plain
application values that have no crypto role, such as an API token. Unlike key
material, secrets **can** be read back in plaintext (that is their whole point),
but they are still sealed at rest through the same driver.

```typescript
const id = await provider.key.store.secrets.put("my-api-token", { name: "API Token" });
const value = await provider.key.store.secrets.get(id); // the bytes back
```

## The Node command line tool

The Node package ships a small command line tool called `keystore`. It lets you
create and use keys straight from your terminal, backed by your operating
system's real keychain.

Because the package is not published to a public registry yet, you build it once
and run it from the workspace:

```sh
pnpm install
pnpm --filter @algorandfoundation/keystore-node build
pnpm exec keystore --help
```

Some things you can do:

```sh
keystore list                 # show the keys you have
keystore generate seed        # make a new seed
keystore generate account     # derive an account
keystore sign <id> <message>  # sign something
keystore verify ...           # verify a signature
keystore algorithms           # show active capabilities
keystore serve                # run the RPC service (see below)
```

Run `keystore --help` at any time to see the full list.

## The Node RPC service

Sometimes one process holds the keys and **another** process wants to use them,
without ever seeing the secrets. The Node package supports this with an RPC
(remote procedure call) service.

- One process runs `keystore serve`. It hosts the real keystore and listens on a
  private local socket on the same machine (not an open network port), so the
  operating system's file permissions control who can talk to it.
- Another process uses a **client engine** that looks and behaves exactly like a
  normal keystore. Every call it makes is forwarded over the socket to the
  service, and only the results come back.

Because the client fulfils the same contract as the in-process keystore, you can
drop it into a provider the same way. Your code does not need to know it is
talking to a remote keystore. The secrets stay in the process that runs `serve`.

## File naming conventions

If you go poking around the source, these names are used consistently:

- `store.ts`: the pure operations for a data domain (creating, updating state).
- `extension.ts`: defines an extension and wires it onto a provider.
- `types.ts`: TypeScript interfaces and types only, no runnable logic.
- `errors.ts`: the error definitions for a module.

The codebase prefers plain functions over classes and avoids hidden state, which
makes things easier to test and reason about. (Custom error classes are the one
allowed exception.)

## Where to go next

- Want the full internals and the exact list of key types? Read the
  [`core` package README](./core/README.md).
- Building for the browser? See the [`web` package README](./web/README.md).
- Building for Node or a server? See the [`node` package README](./node/README.md).
- Building a mobile app? See the
  [`react-native` package README](./react-native/README.md).
- Just want it to "pick the right one for me"? Use the
  [`meta` package](./meta/README.md).

There are also runnable example apps under the repository's `examples/` folder
(a web example, a Node example, and a React Native wallet) that show all of this
wired together end to end.

## License

Apache-2.0
