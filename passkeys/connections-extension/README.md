# 🔑🌉 @algorandfoundation/passkeys-connections-extension

Bridge between the Passkeys Store and Connections.

This package bridges the [Passkeys Store](../core) and the [Connections](../../connections/core) domain seam. It mounts the passkeys store's session-scoped **remote mirror** at `provider.passkey.remote`, the `{ expose, receive, revoke }` surface the connections engines duck-type (`discoverDomains`) to exchange passkey metadata over a session. The bridge itself mounts as the `WithPasskeysConnections` Wallet Provider Extension; the passkeys store it mirrors into runs fully standalone.

## ✨ Features

- **Session mirrors**: The metadata of a remote peer's passkeys is written into the same reactive store the local feeders fill, and leaves again when the session ends.
- **Locals win**: `receive()` skips records whose credential id a local passkey already claims; `expose()` never echoes a session's mirror back to the peer that shared it.
- **Reactive pruning**: When a mirrored record leaves the store through any other path (UI removal, clear), the mirror's tracking is pruned so a locally re-added record stays local.

## 🧱 Core Components

- [**`remotePasskeysMirror`**](./src/remote.ts): The pure store helper backing the mirror (`expose` / `receive` / `revoke`) with per-session credential-id tracking.
- [**`WithPasskeysConnections`**](./src/extension.ts): The Wallet Provider Extension that mounts the mirror at `provider.passkey.remote`. It returns only the `passkey.remote` member it contributes.
- [**`PasskeysConnectionsOptions`**](./src/extension.ts): The options shape, the same `PasskeysOptions` of `@algorandfoundation/passkeys-core` (the shared `options.passkeys` namespace); the bridge reads `passkeys.store` only.

## 📥 Installation

```bash
pnpm add @algorandfoundation/passkeys-connections-extension
```

## 🚀 Quick Start

### With a Provider

The `WithPasskeysConnections` extension requires the **shared passkeys store** (the same instance backing `WithPasskeys`) via `options.passkeys.store`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithPasskeys } from "@algorandfoundation/passkeys-core";
import { WithPasskeysConnections } from "@algorandfoundation/passkeys-connections-extension";
import { Store } from "@tanstack/store";

const passkeysStore = new Store({ passkeys: [] });

const MyProvider = Provider.withExtensions([WithPasskeys, WithPasskeysConnections]);

const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    passkeys: { store: passkeysStore },
  },
);
```

#### Configuration

The bridge reads the shared `options.passkeys` namespace (`PasskeysNamespace`,
registered on the `ExtensionOptions` registry by `@algorandfoundation/passkeys-core`)
and registers **no fields of its own**:

| Option           | Type                   | Default    | Registered by                       | Description                                                                                      |
| ---------------- | ---------------------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `passkeys.store` | `Store<PasskeysState>` | _required_ | `@algorandfoundation/passkeys-core` | The **shared** passkeys store (the same instance passed to `WithPasskeys`); throws when missing. |

### Standalone

The mirror is pure store code and can be used without a provider:

```typescript
import { remotePasskeysMirror } from "@algorandfoundation/passkeys-connections-extension";

const remote = remotePasskeysMirror(passkeysStore);
remote.receive("session-1", walletPasskeys);
// ... the wallet's passkeys ride the same reactive store ...
remote.revoke("session-1");
```

## 📄 License

Apache-2.0
