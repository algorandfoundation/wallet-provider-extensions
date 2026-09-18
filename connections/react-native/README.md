# @algorandfoundation/react-native-connections

The React Native (wallet-side / **responder-role**) connections engine for
Algorand Providers.

This package supports both usage modes as first-class citizens. For the
Provider/Extensions pattern it ships a `WithConnections` Wallet Provider
Extension, which is a thin wrapper around `createConnectionsStore` of
[`@algorandfoundation/connections-core`](../core/README.md). The extension is
the package's only runtime surface, so the equally supported **standalone**
path runs on the core engine directly (see
[Standalone Usage](#standalone-usage)); the extension adds only the Provider
mounting on top. Either way the engine carries **zero protocol logic**: wallets
register protocols (e.g. `liquidAuth({...})` from
[`@algorandfoundation/connections-liquid-auth`](../liquid-auth/README.md) with
wallet seams), and the engine routes `accept(uri)` for scanned/pasted requests
along with `resume(sessionId)` for renegotiating persisted sessions over the
protocol's signaling service and `disconnect`, through the protocol registry.

Most applications should depend on the meta package
[`@algorandfoundation/connections`](../meta/README.md), which selects this
package automatically via the `react-native` export condition (Metro).

## Installation

```bash
pnpm add @algorandfoundation/react-native-connections
```

Peer dependencies: [`@tanstack/store`](https://tanstack.com/store) and
`before-after-hook`. `@algorandfoundation/logs` is an **optional** peer; when
its `WithLogs` extension is present on the provider, the engine logs through
`provider.log`.

## Provider Integration (`WithConnections`)

```typescript
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";
import { WithConnections } from "@algorandfoundation/react-native-connections";
import { Provider } from "@algorandfoundation/wallet-provider";

const MyProvider = Provider.withExtensions([WithConnections]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    connections: {
      protocols: [
        liquidAuth({
          authSigner: (challenge) => wallet.signChallenge(challenge),
          wallet: {
            signTransactions: (txns, indexesToSign) => wallet.sign(txns, indexesToSign),
            approveConnect: (params) => promptUser(params),
          },
        }),
      ],
      driver: mmkvConnectionDriver,
    },
  },
);

await provider.connection.ready;
const session = await provider.connection.accept(scannedLiquidUri);

// Later, when the transport dropped (session is `disconnected`):
await provider.connection.resume(session.id);
```

Sessions are held in memory unless a durable driver is injected; any two-method
`ConnectionKeyValueStore` works, e.g. an MMKV wrapper:

```typescript
const mmkvConnectionDriver = {
  get: (key: string) => mmkv.getString(key) ?? null,
  set: (key: string, value: string) => mmkv.set(key, value),
};
```

## Standalone Usage

No Provider is required to run wallet-side connections. The engine, the
responder role and the protocol registry all come from
[`@algorandfoundation/connections-core`](../core/README.md) and compose
directly, following the same flow `WithConnections` runs for you:

```typescript
import { createConnectionsStore } from "@algorandfoundation/connections-core";
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";

const { api, protocols, ready } = createConnectionsStore({
  driver: mmkvConnectionDriver,
  protocols: [
    liquidAuth({
      authSigner: (challenge) => wallet.signChallenge(challenge),
      wallet: {
        signTransactions: (txns, indexesToSign) => wallet.sign(txns, indexesToSign),
        approveConnect: (params) => promptUser(params),
      },
    }),
  ],
});
await ready;

// Drive the responder role directly through the protocol registry.
const responder = protocols.createResponder("liquid-auth", { sessions: api });
const { sessionId, transport } = await responder.accept(scannedLiquidUri);
```

The extension adds session bookkeeping, resume orchestration and domain
discovery on top of this flow; both modes stay interchangeable. See the
[core README](../core/README.md) for the full primitive surface (wallet
responder, secure channel, messaging).

## The `provider.connection` API

The extension mounts a `ReactNativeConnectionApi` at `provider.connection`
(plus the reactive `provider.connections` session list):

- **`accept(request, protocolId?)`**: Accepts an inbound connection request (scanned/pasted URI or protocol payload, e.g. a `liquid://` URI) and resolves with the connected session. `protocolId` may be omitted when exactly one protocol is registered.
- **`resume(sessionId, protocolId?)`**: Renegotiates a persisted (disconnected) session over the protocol's signaling service: the wallet side re-offers to the waiting peer, reusing the still-authenticated signaling session where the protocol supports it. This means there is no new out-of-band request, no repeated authentication ceremony. Concurrent resumes of the same session share one attempt.
- **`disconnect(sessionId)`**: Closes the session's live connection and marks it `disconnected`.
- **`store`** / **`protocols`** / **`ready`**: The session CRUD API, the protocol registry and the hydration promise (hydrated sessions are coerced to `disconnected` because transports never survive restarts).

## Domains

During `connect` the two sides exchange their **connection domains**. By
default they are inferred from the provider surface (see `discoverDomains` of
core): every mounted store extension (`provider.account.store`,
`provider.identity.store`, `provider.passkey.store`,
`provider.credential.store`) announces its domain, so apps declare nothing.
Protocol responders consume the registry via `ProtocolContext.domains` to
answer the `connect` inventory exchange. Pass an explicit
`options.connections.domains` list to override or extend the inferred set.

## Configuration

`WithConnections` reads the `options.connections` namespace (`ConnectionsNamespace`, registered on the shared `ExtensionOptions` registry by [`@algorandfoundation/connections-core`](../core/README.md) so it is typed at the composition root). This package adds no platform-specific fields to that interface; the `ReactNativeConnectionsOptions` type it exports is an alias of core's `ConnectionsOptions`, so both names type the same options object.

| Option                   | Type                      | Default                        | Description                                                                                                                     |
| ------------------------ | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `connections.protocols`  | `ConnectionProtocol[]`    | `[]`                           | Protocols the engine hosts (e.g. `liquidAuth({...})` with wallet seams); `accept` / `resume` route through the registry. (core) |
| `connections.driver`     | `ConnectionKeyValueStore` | `memoryConnectionDriver()`     | Two-method persistence driver for the sessions/messages snapshot; inject an MMKV/AsyncStorage wrapper for durability. (core)    |
| `connections.store`      | `Store<ConnectionsState>` | fresh empty store              | The reactive store the engine writes to. Pass your own to subscribe from the UI. (core)                                         |
| `connections.hooks`      | `HookCollection`          | fresh collection               | `before-after-hook` collection wrapping every store operation. (core)                                                           |
| `connections.storageKey` | `string`                  | `DEFAULT_CONNECTIONS_KEY`      | Key the snapshot is persisted under. (core)                                                                                     |
| `connections.domains`    | `ConnectionDomains`       | inferred via `discoverDomains` | Connection domains announced during `connect`; override or extend the inferred set. (core)                                      |

## License

Apache-2.0
