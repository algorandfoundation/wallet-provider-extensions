# Wallet Provider Extensions

[![CI](https://github.com/algorandfoundation/wallet-provider-extensions/actions/workflows/integrate.yaml/badge.svg)](https://github.com/algorandfoundation/wallet-provider-extensions/actions/workflows/integrate.yaml)
[![License](https://img.shields.io/github/license/algorandfoundation/wallet-provider-extensions)](https://github.com/algorandfoundation/wallet-provider-extensions/blob/main/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/wallet-provider-extensions)](https://www.npmjs.com/package/wallet-provider-extensions)

Based on the work of the [Wallet Provider](https://github.com/algorandfoundation/wallet-provider),
this project adds support for various extensions that allow for cryptographic operations in specific contexts.

## What are Extensions?

Extensions are modular components that enhance the capabilities of a wallet or provider. They allow for the addition of specialized features—such as secret management, logging, or custom signing—without bloating the core provider implementation.

An extension typically consists of:

1.  **State**: Data managed by the extension (e.g., a list of stored secrets).
2.  **API**: A set of methods to interact with the extension and its state.

## Available Extensions

Each domain is built around a **generic store** that holds the canonical state and exposes a small, pure API. Stores are intentionally source-agnostic: they don't require a keystore — records can just as easily come from an RPC service, an indexer, a remote wallet, or any other producer.

On top of each store, the project ships optional **bridge extensions** that wire the store to a specific source (e.g. the local keystore), and a **unified/meta extension** per domain that bundles the store plus any optional bridges, conditionally enabling them only when the underlying dependency is present.

> 💡 **Recommended:** For most developers, the **unified extension** for each domain is the best entry point. It hides the wiring between stores and bridges, conditionally enables capabilities based on what the provider exposes, and lets you opt down to the generic store or individual bridges only when you need finer control.

### Keystore

Cryptographic key material management — generation, derivation, and secure storage.

**Unified Extension** _(recommended)_: _TODO — a `@algorandfoundation/keystore-extension` meta-package that composes the store with the best available platform bridge (RN, web, node) via conditional loading._

Building blocks:

- **Generic Store**: **[Keystore Core](./keystore/store)** — core types, interfaces, and the reactive store for secret management.
- **Source Bridges**:
  - **[React Native Keystore](./keystore/react-native)** — secure implementation for React Native using Keychain/MMKV.
    - [**Integration Guide**](./keystore/react-native/BOOTSTRAPPING.md): how to adopt the keystore in React Native.
  - **[Open Wallet Standard adapter](./keystore/node#open-wallet-standard-ows-adapter)** — binds the node keystore to an [OWS](https://openwallet.sh/) vault (via the OWS NAPI bindings or the `ows` CLI), so OWS keeps custody of the seed and enforces its policy engine while the provider keeps this project's API.
  - **[Remote Keystore](./keystore/remote)** — the keystore across a boundary: a pure, transport-neutral JSON-RPC protocol with a drop-in client engine, a host-side responder and a Provider extension. Run a keystore daemon (local socket or WebSocket, via [keystore-node](./keystore/node#reaching-the-daemon-transports)) and drive it from another process, another machine or a web page — application code cannot tell the difference. Keystores are **namespaced**: the extension mounts at `provider.key.store` by default, or under a name of its own (`provider.key.rpc.ows`) so remote services can sit beside a local keystore on the same provider. See the [remote example](./examples/node-keystore-remote).

### Accounts

On-chain account lifecycle. Accounts may be backed by keystore-managed keys, **or** sourced from third parties such as RPC services, indexers, or watch-only feeds.

**Unified Extension** _(recommended)_: _TODO — a `@algorandfoundation/accounts-extension` meta-package that wraps the account store and conditionally enables the keystore bridge (and future RPC/indexer bridges) based on what the provider exposes._

Building blocks:

- **Generic Store**: **[Account Store](./accounts/store)** — reactive store for managing accounts, independent of any specific source.
- **Source Bridges**:
  - **[Accounts Keystore Bridge](./accounts/keystore-extension)** — optional bridge that populates the account store from keystore-derived keys when a keystore is available.

### Identities

Decentralized identity (DID) management. Identities can be derived from keystore-managed seeds, but the store itself is generic and can equally hold imported, resolved, or remotely-issued DIDs.

**Unified Extension** _(recommended)_: **[Identities Extension](./identities/extension)** — meta-package that bundles the identity store with the keystore bridge, dynamically loading the bridge only when the provider exposes a keystore.

Building blocks:

- **Generic Store**: **[Identity Store](./identities/store)** — reactive store for managing identities and DIDs.
- **Source Bridges**:
  - **[Identities Keystore Bridge](./identities/keystore-extension)** — optional bridge that builds DID documents from keystore-managed seeds and their derived keys.

### Observability

Cross-cutting extensions for tracking wallet activity.

**Unified Extension** _(recommended)_: _TODO — a `@algorandfoundation/log-extension` meta-package that composes the log store with conditional sinks._

Building blocks:

- **Generic Store**: **[Log Store](./log)** — generalized logging store for wallet activity.
- **Source Bridges**: _TODO — adapters that forward log entries to external sinks (remote telemetry, file, console transport, etc.)._

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

export default loggerExtension;
```

## Using Extensions in a Provider

Extensions are typically used by extending the base `Provider` class. This "concrete provider" pattern provides full type safety for both the core provider and all its extensions.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/react-native-keystore";
import { WithLogStore } from "@algorandfoundation/log-store";
import { keyStore } from "./stores/keystore";
import { logStore } from "./stores/logstore";

// 1. Define your application's provider with extensions
export class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithLogStore, WithKeyStore] as const;

  // Add properties for type-safe access to extension state/APIs
  logs!: string[];
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
    logs: { store: logStore },
    keystore: {
      extension: { store: keyStore },
    },
  },
);

// 3. Access extension APIs directly on the provider
await provider.keystore.generate({ type: "hd-seed", algorithm: "raw" });
provider.log("Generated a new seed");
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
