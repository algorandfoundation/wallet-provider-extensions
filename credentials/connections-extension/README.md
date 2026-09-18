# 🪪🌉 @algorandfoundation/credentials-connections-extension

Bridge between the Credential Store and Connections.

This package bridges the [Credential Store](../core) and the [Connections](../../connections/core) domain seam. It mounts the credential store's session-scoped **remote mirror** at `provider.credential.remote`, the `{ expose, receive, revoke }` surface the connections engines duck-type (`discoverDomains`) to exchange credential metadata over a session. The bridge itself mounts as the `WithCredentialsConnections` Wallet Provider Extension; the credential store it mirrors into runs fully standalone.

## ✨ Features

- **Session mirrors**: The presentation metadata of a remote peer's credentials is written into the same reactive store the local credentials live in — tagged with the `metadata.source: "connection"` discriminant plus the session id — and leaves again when the session ends.
- **Metadata only**: The wire type is `CredentialRecord`, the store's `Credential` minus `raw`, `claims`, and `receivedAt`; claim disclosure stays a deliberate OID4VP presentation flow.
- **No echo**: `expose()` never sends a session's mirror back to the peer that shared it; `isRemoteCredential` discriminates mirrors (optionally per session).

## 🧱 Core Components

- [**`remoteCredentialsMirror`**](./src/remote.ts): The pure store helper backing the mirror (`expose` / `receive` / `revoke`) with per-session tagging via `metadata.source`/`metadata.sessionId`.
- [**`WithCredentialsConnections`**](./src/extension.ts): The Wallet Provider Extension that mounts the mirror at `provider.credential.remote`.

## 📥 Installation

```bash
pnpm add @algorandfoundation/credentials-connections-extension
```

## 🚀 Quick Start

### With a Provider

The `WithCredentialsConnections` extension requires the **shared credential store** (the same instance backing the platform `WithCredentials` extensions) via `options.credentials.store`.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithCredentials } from "@algorandfoundation/credentials-web";
import { WithCredentialsConnections } from "@algorandfoundation/credentials-connections-extension";
import { Store } from "@tanstack/store";

const credentialStore = new Store({
  credentials: [],
  issuanceSessions: [],
  verificationSessions: [],
});

const MyProvider = Provider.withExtensions([WithCredentials, WithCredentialsConnections]);

const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    credentials: { store: credentialStore },
  },
);
```

The platform packages (`@algorandfoundation/credentials-node`, `@algorandfoundation/credentials-web`, `@algorandfoundation/react-native-credentials`, resolved by the `@algorandfoundation/credentials` meta) auto-load this bridge over their engine-resolved store, so mounting them alone already announces and mirrors the credentials domain; `await provider.credential.store.ready` guarantees the mirror is mounted. The extension returns only `{ credential: { remote } }` and is idempotent (an already-mounted `provider.credential.remote` is reused).

### Configuration

The bridge reads the shared `options.credentials` namespace (`CredentialsNamespace`, registered on `ExtensionOptions` by [`@algorandfoundation/credentials-core`](../core)); it adds no fields of its own.

| Field               | Type                          | Default          | Description                                                                                                                     |
| ------------------- | ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `credentials.store` | `Store<CredentialStoreState>` | — (**required**) | The shared TanStack store the `createCredentialStore` engine resolved; the bridge mirrors peer records into it, never owns one. |

### Standalone

The mirror is pure store code and can be used without a provider:

```typescript
import { remoteCredentialsMirror } from "@algorandfoundation/credentials-connections-extension";

const remote = remoteCredentialsMirror(credentialStore);
remote.receive("session-1", peerCredentialMetadata);
// ... the peer's inventory renders from the same reactive store ...
remote.revoke("session-1");
```

## 📄 License

Apache-2.0
