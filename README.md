# Wallet Provider Extensions

[![CI](https://github.com/algorandfoundation/wallet-provider-extensions/actions/workflows/integrate.yml/badge.svg)](https://github.com/algorandfoundation/wallet-provider-extensions/actions/workflows/integrate.yml)
[![License](https://img.shields.io/github/license/algorandfoundation/wallet-provider-extensions)](https://github.com/algorandfoundation/wallet-provider-extensions/blob/main/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/wallet-provider-extensions)](https://www.npmjs.com/package/wallet-provider-extensions)

Based on the work of the [Wallet Provider](https://github.com/algorandfoundation/wallet-provider),
this project adds support for various extensions that allow for cryptographic operations in specific contexts.

## What are Extensions?

Extensions are modular components that enhance the capabilities of a wallet or provider. They allow for the addition of specialized features, such as secret management, logging, or custom signing, without bloating the core provider implementation.

An extension typically consists of:

1.  **State**: Data managed by the extension (e.g., a list of stored secrets).
2.  **API**: A set of methods to interact with the extension and its state.

## Available Extensions

Each domain is built around a **generic store** that holds the canonical state and exposes a small, pure API. Stores are intentionally source-agnostic: they don't require a keystore; records can just as easily come from an RPC service, an indexer, a remote wallet, or any other producer.

On top of each store, the project ships optional **bridge extensions** that wire the store to a specific source (e.g. the local keystore), and a **unified/meta extension** per domain that bundles the store plus any optional bridges, conditionally enabling them only when the underlying dependency is present.

> 💡 **Recommended:** For most developers, the **unified extension** for each domain is the best entry point. It hides the wiring between stores and bridges, conditionally enables capabilities based on what the provider exposes, and lets you opt down to the generic store or individual bridges only when you need finer control.

### Keystore

Cryptographic key material management: generation, derivation, and secure storage. Signing keys come in two first-class flavors, classical Ed25519 and post-quantum Falcon-1024, both of which can grow from the same recovery-phrase seed.

**Meta Package** _(recommended)_: **[Keystore](./keystore/meta)** (`@algorandfoundation/keystore`), which resolves to the best available platform implementation (React Native, web, node) via conditional exports.

Building blocks:

- **Core**: **[Keystore Core](./keystore/core)**, which includes core types, interfaces, and the reactive store for secret management.
- **Platform Implementations**:
  - **[React Native Keystore](./keystore/react-native)**: a secure implementation for React Native using Keychain/MMKV.
    - [**Integration Guide**](./keystore/react-native/BOOTSTRAPPING.md): how to adopt the keystore in React Native.
  - **[Web Keystore](./keystore/web)**: a browser implementation backed by IndexedDB and WebCrypto.
  - **[Node Keystore](./keystore/node)**: a WebCrypto/noble implementation for Node.js and other server runtimes.

### Accounts

On-chain account lifecycle. Accounts may be backed by keystore-managed keys, **or** sourced from third parties such as RPC services, indexers, or watch-only feeds.

**Meta Package** _(recommended)_: **[Accounts](./accounts/meta)** (`@algorandfoundation/accounts`), the platform-conditional entry point apps import `WithAccounts` from.

Building blocks:

- **Core**: **[Accounts Core](./accounts/core)**, providing the accounts API and reactive store (`WithAccounts`), independent of any specific source.
- **Source Bridges**:
  - **[Accounts Keystore Bridge](./accounts/keystore-extension)** _(example)_: a reference bridge that populates the account store from keystore-derived keys. The production Algorand accounts implementation is the **[Algorand Accounts Extension](./accounts/algorand-extension)**.
  - **[Algorand Accounts Extension](./accounts/algorand-extension)**: the production bridge, providing concrete Algorand addresses (ed25519 public keys, canonical post-quantum digests for Falcon-1024), live balances, and assets via an algod watchlist subscriber.

### Identities

Decentralized identity (DID) management. Identities can be derived from keystore-managed seeds, but the store itself is generic and can equally hold imported, resolved, or remotely-issued DIDs.

**Meta Package** _(recommended)_: **[Identities](./identities/meta)** (`@algorandfoundation/identities`), which owns the unified `WithIdentities` extension and dynamically loads the keystore bridge only when the provider exposes a keystore.

Building blocks:

- **Core**: **[Identities Core](./identities/core)**, which includes the identities API and reactive store (`WithIdentities`, DID-document helpers).
- **Source Bridges**:
  - **[Identities Keystore Bridge](./identities/keystore-extension)**: an optional bridge that builds DID documents from keystore-managed seeds and their derived keys.

### Credentials

Verifiable credential issuance, holding, and presentation (W3C VC / digital credentials).

**Meta Package** _(recommended)_: **[Credentials](./credentials/meta)** (`@algorandfoundation/credentials`), the platform-conditional entry point apps import `WithCredentials` from.

Building blocks:

- **Core**: **[Credentials Core](./credentials/core)**, which is the credentials engine and reactive store, independent of any platform wallet API.
- **Platform Implementations**:
  - **[Web Credentials](./credentials/web)**: a browser implementation on top of the Digital Credentials API.
  - **[React Native Credentials](./credentials/react-native)**: a React Native implementation.
  - **[Node Credentials](./credentials/node)**: a Node.js implementation for servers, CLIs, and tests.
- **Source Bridges**:
  - **[Credentials Intermezzo Bridge](./credentials/intermezzo-extension)**: an optional bridge that issues credentials through the Intermezzo service.
  - **[Identities Intermezzo Bridge](./identities/intermezzo-extension)**: an optional bridge that anchors identities through the Intermezzo service.

### Connections

Peer connections between wallets and dapps: session state, transports, protocols, and secure messaging.

**Meta Package** _(recommended)_: **[Connections](./connections/meta)** (`@algorandfoundation/connections`), which resolves to the right platform engine and bundles the default protocols.

Building blocks:

- **Core**: **[Connections Core](./connections/core)**, which includes the connections store, transport/protocol seams, wallet RPC, and secure channel primitives.
- **Platform Implementations**:
  - **[Web Connections](./connections/web)**: the dapp/requester role for browsers.
  - **[React Native Connections](./connections/react-native)**: the wallet/responder role for React Native.
- **Protocols**:
  - **[Liquid Auth](./connections/liquid-auth)**: the `liquid://` QR + WebAuthn + WebRTC connection protocol.

### Passkeys

Passkey (WebAuthn credential) inventory management.

**Meta Package** _(recommended)_: **[Passkeys](./passkeys/meta)** (`@algorandfoundation/passkeys`), which owns the unified `WithPasskeys` extension and lazily loads the connections bridge when the provider exposes connections. See the [domain overview](./passkeys) for which packages to install.

Building blocks:

- **Core**: **[Passkeys Core](./passkeys/core)**, consisting of the platform-neutral passkey store functions (`WithPasskeys`) and reconciliation helpers.
- **Bridges**:
  - **[Passkeys Keystore Extension](./passkeys/keystore-extension)**, which mirrors keystore-derived P256 domain keys into the passkeys store (`WithPasskeysKeystore`).
  - **[Passkeys Connections Extension](./passkeys/connections-extension)**, which mirrors a connected peer's passkeys over a session (`WithPasskeysConnections`).
- **Platform Implementations**:
  - **[React Native Passkeys](./passkeys/react-native)**, whose native feeder syncs the passkey autofill module into the store.

### Observability

Cross-cutting extensions for tracking wallet activity.

Building blocks:

- **Generic Store**: **[Logs](./logs)** (`@algorandfoundation/logs`), a generalized logging store for wallet activity (`WithLogs`).

### Migrations

Versioned state migrations for provider stores.

Building blocks:

- **[Provider Migrations](./migrations)** (`@algorandfoundation/provider-migrations`), which provides helpers for migrating persisted provider state between versions.

## Creating a New Extension

To create a new extension, you define an interface that combines your custom state and your API.

### Example: Logger Extension

Imagine you want an extension that logs all wallet activities.

#### 1. Define the Extension Types

```typescript
export interface LoggerState {
  logs: string[];
}

export interface LoggerApi {
  log: (message: string) => void;
  clear: () => void;
}

export interface LoggerExtension extends LoggerState {
  logger: LoggerApi;
}
```

#### 2. Implement the Extension

```typescript
import { Store } from "@tanstack/store";
import type { Provider, ExtensionOptions } from "@algorandfoundation/wallet-provider";

const store = new Store<LoggerState>({ logs: [] });

export const loggerExtension: (
  provider: Provider,
  options: ExtensionOptions,
) => LoggerExtension = () => ({
  get logs() {
    return store.state.logs;
  },
  logger: {
    log: (message: string) => {
      store.setState((state) => ({
        logs: [...state.logs, `${new Date().toISOString()}: ${message}`],
      }));
    },
    clear: () => {
      store.setState(() => ({ logs: [] }));
    },
  },
});
```

#### 3. Register the options namespace

Every extension claims one `options.<domain>` block on the shared `ExtensionOptions` registry, so the composed provider's constructor type-checks the whole options bag. The domain core registers a **named namespace interface**; platform and bridge packages augment that interface with their extras instead of registering the key again:

```typescript
export interface LoggerNamespace {
  store?: Store<LoggerState>;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    logger?: LoggerNamespace;
  }
}
```

See [`AGENTS.md`](./AGENTS.md#options-registry) for the full convention (and the [docs guide](https://algorandfoundation.github.io/wallet-provider-extensions/guides/create-an-extension/)).

## Two ways to use the packages

Every domain in this repository works in two modes, and both are first-class:

1. **Standalone**: each package's engine and pure store functions run on their own, with no Provider anywhere in sight. Use this when you want a single capability (say, a keystore or a connections engine) inside an existing application.
2. **Composed in a Provider**: each package ships a `With*` extension that mounts the same engine onto the Algorand Wallet Provider, where extensions can discover each other (accounts finding the keystore, stores logging through `provider.log`, and so on).

### Using a package standalone

The engines are plain factories over reactive [`@tanstack/store`](https://tanstack.com/store) stores; create one, await `ready`, and call it directly:

```typescript
import { Store } from "@tanstack/store";
import { createNodeKeyStore } from "@algorandfoundation/keystore";

const store = new Store({ keys: [], status: "idle" });
const keystore = createNodeKeyStore({ store });
await keystore.ready;

const id = await keystore.generate({
  type: "ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign", "verify"],
});
const signature = await keystore.sign(id, new TextEncoder().encode("hi"));

// Post-quantum keys are first-class peers: grow a Falcon-1024 key from a seed
// and use it through the exact same calls.
const seedId = await keystore.importSeed(seedBytes, { name: "Wallet Seed" });
const falconId = await keystore.generate({
  type: "falcon-1024",
  algorithm: "Falcon-1024",
  extractable: false,
  keyUsages: ["sign", "verify"],
  params: { parentKeyId: seedId },
});
const pqSignature = await keystore.sign(falconId, new TextEncoder().encode("hi"));
```

The same pattern holds across domains: `createConnectionsStore`, the credentials engines, and the pure accounts/identities/passkeys store functions all run without a Provider. See each package's README for its standalone entry point.

### Using Extensions in a Provider

For composition, extend the base `Provider` class. This "concrete provider" pattern provides full type safety for both the core provider and all its extensions.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/react-native-keystore";
import { WithLogs, type LogMessage } from "@algorandfoundation/logs";
import { keyStore, keyStoreHooks } from "./stores/keystore";
import { logStore } from "./stores/logstore";

// 1. Define your application's provider with extensions
export class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithLogs, WithKeyStore] as const;

  // Add properties for type-safe access to extension state/APIs
  logs!: LogMessage[];
  keys!: any[];
  status!: string;
}

// 2. Initialize the provider with required options
const provider = new MyProvider(
  {
    id: "my-app",
    name: "My Application",
  },
  {
    log: { store: logStore },
    keystore: { store: keyStore, hooks: keyStoreHooks },
  },
);

// 3. Access extension APIs directly on the provider
await provider.key.store.generate({ type: "seed", algorithm: "raw" });
provider.log.info("Generated a new seed");
console.log(provider.keys); // Reactive list of keys
```

## Acknowledgments

<!-- TODO: Refine acknowledgements as they develop -->

We would like to acknowledge the following individuals and entities for their contributions and inspiration to this project and the broader Algorand ecosystem:

- **Architectural Vision**: [Algorand Foundation](https://github.com/algorandfoundation) and [Bruno Martins](https://github.com/bmartins) (@bmartins) for his role as an Architect.
- **use-wallet**: [TxnLab](https://github.com/TxnLab) and [Doug Richar](https://github.com/drichar) (@drichar), along with [Gabriel Kuettel](https://github.com/gabrielkuettel) (@gabrielkuettel) (currently at Algorand Foundation), for their role in building the `use-wallet` hook.
- **Ecosystem Support**: The Engineering Teams at [Algorand Foundation](https://github.com/algorandfoundation) ranging from AlgoKit, Engineering, and Devrel for their role in providing ecosystem libraries and support.
- **Wallets**:
  - [Pera](https://github.com/perawallet) and [Will Beaumount](https://github.com/mjbeau) (@mjbeau) for their role in the ecosystem as a wallet and the large refactor to React Native.
  - [Akita](https://akita.community/) for their role in ARC58 adoption. With special thanks to Algorand Foundation engineering to [Kyle](https://github.com/kylebeee)(@kylebee) and [Joe Polny](https://github.com/joe-p)(@joe-p) for their contributions to the ARC58 plugin standards.
  - [Lute](https://lute.app) and [Andrew Funk](https://github.com/acfunk) (@acfunk) for their contributions to web wallets, readily adopting the latest features.
  - [Kibis-is](https://kibis.is/) and [Kieran Roneill](https://github.com/kieranroneill) (@kieranroneill) for their work as an extension-based wallet and contributions to ARC standards such as ARC27.
  - [Defly](https://defly.app/) and [Kevin Wellenzohn](https://github.com/k13n) (@k13n) for pioneering wallet features and deep engagement with the Algorand ecosystem and ARC standards.
