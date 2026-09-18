# 🪪🌉 @algorandfoundation/identities-connections-extension

Bridge between the Identity Store and Connections.

This package bridges the [Identity Store](../core) and the [Connections](../../connections/core) domain seam. It mounts the identity store's session-scoped **remote mirror** at `provider.identity.remote`, the `{ expose, receive, revoke }` surface the connections engines duck-type (`discoverDomains`) to exchange identity records over a session. The bridge itself mounts as the `WithIdentitiesConnections` Wallet Provider Extension; the identity store it mirrors into runs fully standalone.

## ✨ Features

- **Session mirrors**: A remote peer's identities land in the same reactive store the local identities live in (tagged `metadata.source: "connection"` plus the session id), and leave again when the session ends.
- **Data-only wire records**: `expose()` strips function members (`sign`) and excludes session mirrors (no echo); `receive()` re-attaches the session-routed `sign` from the receive context.
- **`IdentityRecord` wire shape**: records travel as `@algorandfoundation/identities-core`'s `IdentityRecord` (the identity minus `sign`), public fields and DID documents only.

## 🧱 Core Components

- [**`remoteIdentitiesMirror`**](./src/remote.ts): The pure store helper backing the mirror (`expose` / `receive` / `revoke`), plus the `isRemoteIdentity` / `REMOTE_IDENTITY_SOURCE` helpers.
- [**`WithIdentitiesConnections`**](./src/extension.ts): The Wallet Provider Extension that mounts the mirror at `provider.identity.remote`.

## 📥 Installation

```bash
pnpm add @algorandfoundation/identities-connections-extension
```

## 🚀 Quick Start

### With a Provider

The `WithIdentitiesConnections` extension requires the **shared identity store** (the same instance backing `WithIdentities`) via `options.identities.store`.

> 💡 The [`@algorandfoundation/identities`](../meta) meta package's composed `WithIdentities` loads this bridge lazily for you (await `provider.identity.store.ready` before connecting). Mount `WithIdentitiesConnections` directly only when composing the building blocks yourself.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithIdentities } from "@algorandfoundation/identities-core";
import { WithIdentitiesConnections } from "@algorandfoundation/identities-connections-extension";
import { Store } from "@tanstack/store";

const identitiesStore = new Store({ identities: [] });

const MyProvider = Provider.withExtensions([WithIdentities, WithIdentitiesConnections]);

const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    identities: { store: identitiesStore },
  },
);

// What this side shares with a peer (data-only records, no session mirrors)
const records = provider.identity.remote.expose();
```

### Standalone

The mirror is pure store code and can be used without a provider:

```typescript
import { remoteIdentitiesMirror } from "@algorandfoundation/identities-connections-extension";

const remote = remoteIdentitiesMirror(identitiesStore);
remote.receive("session-1", peerIdentities, { sign: sessionSigner });
// ... the peer's identities sit next to the local ones ...
remote.revoke("session-1");
```

## ⚙️ Configuration

The bridge reads the shared `options.identities` block registered by `@algorandfoundation/identities-core` and adds no fields of its own:

| Option             | Type                        | Required | Description                                                                                         |
| ------------------ | --------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `identities.store` | `Store<IdentityStoreState>` | yes      | The **shared** identity store the mirror writes into; the same instance handed to `WithIdentities`. |
| `identities.hooks` | `HookCollection`            | no       | Threaded through to `WithIdentities`; the mirror bypasses hooks and writes straight to the store.   |

## 📄 License

Apache-2.0
