# @algorandfoundation/connections-core

Platform-neutral **remote dapp ↔ wallet connection primitives**, including sessions,
transport contract, wallet RPC, secure channel and the protocol plug-in seam.

This package is the contract everything in the connections domain compiles
against, and every primitive it ships (`createConnectionsStore`,
`createConnectionRpc`, `createWalletResponder`, the secure channel and
messaging helpers) runs **standalone**; no Wallet Provider is required. The same
primitives also power the **first-class Provider path**: the platform packages
([`@algorandfoundation/connections-web`](../web) for the requester role,
[`@algorandfoundation/react-native-connections`](../react-native) for the responder
role) each ship a `WithConnections` Wallet Provider Extension that is a thin
wrapper around this engine. Both modes are equal citizens; pick whichever fits
your architecture. The package carries **zero protocol logic** and **zero
platform code**: concrete connection protocols (e.g.
[`@algorandfoundation/connections-liquid-auth`](../liquid-auth)) plug into
either mode through the `ConnectionProtocol` interface defined here.

Most applications should depend on the meta package
[`@algorandfoundation/connections`](../meta/README.md); it re-exports this
package from every condition and resolves to the correct platform engine via
package export conditions (`browser` / `react-native` / `node`).

## Installation

```bash
pnpm add @algorandfoundation/connections-core
```

Peer dependencies: [`@tanstack/store`](https://tanstack.com/store) (the reactive
store backing the engine) and `before-after-hook` (the hook collection wrapping
every store operation). `@algorandfoundation/logs` is an **optional** peer; when
its `WithLogs` extension is present on the provider, the engine logs every
store operation through `provider.log`.

## Core Components

- [**`createConnectionsStore`**](./src/engine.ts): The platform-neutral store engine: the hooks-wrapped `ConnectionsStoreApi` (session + message CRUD), the reactive `@tanstack/store` backing it, the `ProtocolRegistry` and a `ready` promise that resolves once persisted sessions have hydrated (coerced to `disconnected` since live transports never survive a restart). Persistence goes through the two-method [`ConnectionKeyValueStore`](./src/engine.ts) driver contract (`memoryConnectionDriver` is the built-in fallback; MMKV, `localStorage` or AsyncStorage adapt in two lines).
- [**`ConnectionTransport`**](./src/types.ts): The minimal duplex message channel a protocol establishes (`send` / `onMessage` / `onStateChange` / `close`). [`createInMemoryTransportPair`](./src/transport.ts) provides a linked pair for tests.
- [**`createConnectionRpc`**](./src/rpc.ts): The JSON-RPC-style request/response layer over a transport, typed by the [`ConnectionMethodMap`](./src/types.ts) (`connect`, `sign_transactions`, `message`, `message_ack`). Failures reject with [`ConnectionRpcError`](./src/errors.ts) and its stable `code` (`timeout`, `transport_closed`, `rejected`, `method_not_found`, …).
- [**`createWalletResponder`**](./src/responder.ts): The wallet-side handler answering `connect` and `sign_transactions`, with `approveConnect` / `approveSignTransactions` gates (typically user prompts), wallet `metadata`, and the domain registry threaded in so `connect` answers the domain inventory exchange.
- [**`ConnectionProtocol`** / **`createProtocolRegistry`**](./src/protocol.ts): The plug-in seam: a protocol contributes `createRequester` (dapp side) and/or `createResponder` (wallet side), and the platform engines route `connect` / `accept` / `resume` calls through the registry.
- [**Domains**](./src/domains.ts): `defineDomain`, `createDomainRegistry` and `discoverDomains`, which is the inventory the two sides exchange during `connect`. Domains are inferred from the provider surface (every mounted store extension announces itself through its `remote` mirror), so apps declare nothing.
- [**Secure channel & messaging**](./src/crypto.ts): `createSecureChannel` builds the symmetric channel between two identities, using X25519 ECDH over the parties' key-agreement keys (or a precomputed `sharedSecret` for non-extractable keys) and HKDF-SHA256 into a 32-byte XChaCha20-Poly1305 key. It includes `x25519KeyPairFromEd25519Seed`, `edwardsToX25519PublicKey` and `keyAgreementPublicKey` as the key-derivation helpers. [`createSecureMessaging`](./src/messaging.ts) layers the `message` / `message_ack` flow (with `pending` → `delivered` → `acknowledged` persistence) over a session's rpc.

## Standalone Usage

Nothing here needs a Provider. The store engine plus the wallet RPC over a
transport; this is the same flow the platform `WithConnections` engines run for you, which
composes directly:

```typescript
import {
  createConnectionRpc,
  createConnectionsStore,
  createWalletResponder,
} from "@algorandfoundation/connections-core";

const { api, store, ready } = createConnectionsStore({ driver: keyValueDriver });
await ready;

// Wallet side: answer `connect` / `sign_transactions` over a transport.
const responder = createWalletResponder({
  signTransactions: (txns, indexesToSign) => wallet.sign(txns, indexesToSign),
  metadata: { name: "My Wallet" },
  approveConnect: (params) => promptUser(params),
});
const detach = responder.attach(createConnectionRpc(transport));

// Dapp side: drive the same rpc from the other end of the transport.
const rpc = createConnectionRpc(dappTransport);
const result = await rpc.request("connect", { metadata: { name: "My Dapp" } });
```

Secure messaging between the paired identities:

```typescript
import {
  createSecureChannel,
  createSecureMessaging,
  keyAgreementPublicKey,
  x25519KeyPairFromEd25519Seed,
} from "@algorandfoundation/connections-core";

const local = x25519KeyPairFromEd25519Seed(identitySeed);
const remote = keyAgreementPublicKey(peerIdentity.didDocument!);
const channel = createSecureChannel({
  privateKey: local.privateKey,
  remotePublicKey: remote!,
});

const messaging = createSecureMessaging({ rpc, channel, sessionId, messages: api });
messaging.attach();
await messaging.send("hello");
```

## Provider Integration

For the Provider/Extensions pattern, mount the `WithConnections` extension of
the platform package for your role:
[`@algorandfoundation/connections-web`](../web) (dapp-side requester) or
[`@algorandfoundation/react-native-connections`](../react-native) (wallet-side
responder), or the meta package
[`@algorandfoundation/connections`](../meta/README.md), which selects the right
one automatically. The extensions build this exact engine (persistence driver,
protocol registry, domain discovery) and mount it at `provider.connection`, so
everything documented here applies unchanged underneath them.

## Configuration

The platform `WithConnections` engines read the `options.connections` namespace (`ConnectionsNamespace`, declared here and registered on the shared `ExtensionOptions` registry so it is typed at the composition root). This package owns the platform-neutral half; the platform packages augment the same interface with their extras (`@algorandfoundation/connections-web` adds `metadata`, `@algorandfoundation/react-native-connections` adds nothing). `ConnectionsOptions` (`ExtensionOptions` narrowed to the `connections` block) lives here too and is what `WebConnectionsOptions` / `ReactNativeConnectionsOptions` alias in the platform packages.

| Option                   | Type                      | Default                        | Description                                                                                                                            |
| ------------------------ | ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `connections.protocols`  | `ConnectionProtocol[]`    | `[]`                           | Protocols the engine hosts (e.g. `liquidAuth({...})`); `connect` / `accept` / `resume` route through the resulting `ProtocolRegistry`. |
| `connections.driver`     | `ConnectionKeyValueStore` | platform-specific              | Two-method persistence driver for the sessions/messages snapshot (`memoryConnectionDriver` is the built-in fallback).                  |
| `connections.store`      | `Store<ConnectionsState>` | fresh empty store              | The reactive store the engine writes to. Pass your own to subscribe from the UI.                                                       |
| `connections.hooks`      | `HookCollection`          | fresh collection               | `before-after-hook` collection wrapping every store operation.                                                                         |
| `connections.storageKey` | `string`                  | `DEFAULT_CONNECTIONS_KEY`      | Key the snapshot is persisted under (`"@algorandfoundation/connections"`).                                                             |
| `connections.domains`    | `ConnectionDomains`       | inferred via `discoverDomains` | Connection domains announced during `connect`; pass an explicit `defineDomain({...})` list to override or extend the inferred set.     |

## License

Apache-2.0
