# @algorandfoundation/connections-web

The browser (dapp-side / **requester-role**) connections engine for Algorand
Providers.

This package serves both usage modes as first-class citizens. For the
Provider/Extensions pattern it ships a `WithConnections` Wallet Provider
Extension, which is a thin wrapper around `createConnectionsStore` of
[`@algorandfoundation/connections-core`](../core/README.md), the same pattern
the credentials/keystore platform packages follow. For **standalone** use it
ships `localStorageConnectionDriver`, the browser persistence driver, which
plugs straight into the core engine with no Provider involved (see
[Standalone Usage](#standalone-usage)). Either way the engine carries **zero
protocol logic**: applications opt into connection protocols (e.g.
`liquidAuth({...})` from
[`@algorandfoundation/connections-liquid-auth`](../liquid-auth/README.md)), and
the engine routes `connect(protocolId)` / `createRequest(protocolId)` through
the protocol registry, completing the wallet RPC handshake over whatever
transport the protocol establishes.

Most applications should depend on the meta package
[`@algorandfoundation/connections`](../meta/README.md), which selects this
package automatically via the `browser` export condition.

## Installation

```bash
pnpm add @algorandfoundation/connections-web
```

Peer dependencies: [`@tanstack/store`](https://tanstack.com/store) and
`before-after-hook`. `@algorandfoundation/logs` is an **optional** peer; when
its `WithLogs` extension is present on the provider, the engine logs through
`provider.log`.

## Provider Integration (`WithConnections`)

```typescript
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";
import { WithConnections } from "@algorandfoundation/connections-web";
import { Provider } from "@algorandfoundation/wallet-provider";

const MyProvider = Provider.withExtensions([WithConnections]);
const provider = new MyProvider(
  { id: "my-dapp", name: "My Dapp" },
  {
    connections: {
      protocols: [liquidAuth({ url: "https://liquid.example.com" })],
      metadata: { name: "My Dapp", url: "https://dapp.example" },
    },
  },
);

const session = await provider.connection.connect("liquid-auth", {
  onFallback: (request) => renderQr(request.qrData),
});

// Later, when the transport dropped (session is `disconnected`):
await provider.connection.resume(session.id);
```

Sessions persist to `localStorage` by default (`memoryConnectionDriver` when
unavailable); inject any two-method `ConnectionKeyValueStore` via
`options.connections.driver`. The `localStorageConnectionDriver` used as the
default is exported too.

## Standalone Usage

No Provider is required to run dapp-side connections in the browser. Beyond the
extension, this package's own surface is the `localStorageConnectionDriver`;
everything else, including the engine, the RPC layer, and the protocol registry, comes from
[`@algorandfoundation/connections-core`](../core/README.md) and composes
directly:

```typescript
import { createConnectionRpc, createConnectionsStore } from "@algorandfoundation/connections-core";
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";
import { localStorageConnectionDriver } from "@algorandfoundation/connections-web";

const { api, protocols, ready } = createConnectionsStore({
  driver: localStorageConnectionDriver(),
  protocols: [liquidAuth({ url: "https://liquid.example.com" })],
});
await ready;

// Drive the requester role directly through the protocol registry.
const requester = protocols.createRequester("liquid-auth", { sessions: api });
const request = await requester.createRequest();
renderQr(request.qrData);

const transport = await request.establish();
const rpc = createConnectionRpc(transport);
const result = await rpc.request("connect", { metadata: { name: "My Dapp" } });
```

The `WithConnections` extension runs this exact flow, adding session
bookkeeping, resume, and domain discovery, so the two modes stay
interchangeable. See the [core README](../core/README.md) for the full
primitive surface (wallet responder, secure channel, messaging).

## The `provider.connection` API

The extension mounts a `WebConnectionApi` at `provider.connection` (plus the
reactive `provider.connections` session list):

- **`connect(protocolId, opts?)`**: Connects through the protocol's preferred path when it has one; otherwise creates the out-of-band request and surfaces it via `opts.onFallback` (render `request.qrData` as a QR). Completes the `connect` RPC and resolves with the connected session, peer domain records included.
- **`createRequest(protocolId)`**: Creates a pending out-of-band request; its `establish()` completes the full handshake before resolving.
- **`resume(sessionId, opts?)`**: Renegotiates a persisted session over the protocol's signaling service, requiring no new out-of-band request or authentication ceremony, and re-runs the `connect` handshake, refreshing the peer's domain records. Concurrent resumes of the same session share one attempt.
- **`signTransactions(sessionId, txns, indexesToSign?)`**: Sends `sign_transactions` over the session's live connection (base64-encoded transaction msgpack, in group order); resolves with the signed txns aligned with the input (`null` where unsigned).
- **`enableSecureMessaging(sessionId, config)`** / **`sendSecureMessage(sessionId, text)`**: Registers a session's `SecureChannel` (typically built via `createSecureChannel` from the X25519 agreement between the dapp's identity key and the wallet's `keyAgreement` key) and seals text messages over it, which are persisted as `pending` → `delivered` → `acknowledged`. The messaging layer is re-attached automatically whenever a resume replaces the transport.
- **`disconnect(sessionId)`**: Closes the session's live connection and marks it `disconnected`.
- **`store`** / **`protocols`** / **`ready`**: The session CRUD API, the protocol registry and the hydration promise.

## Domains

During `connect` the two sides exchange their **connection domains**. By
default they are inferred from the provider surface (see `discoverDomains` of
core): every mounted store extension (`provider.account.store`,
`provider.identity.store`, `provider.passkey.store`,
`provider.credential.store`) announces its domain, so apps declare nothing. The
peer's records are mirrored into the mounted domain stores with a
session-routed signer attached, so a received account signs through the
connection's `sign_transactions` RPC exactly like a local record. Pass an
explicit `options.connections.domains` list to override or extend the inferred
set.

## Configuration

`WithConnections` reads the `options.connections` namespace (`ConnectionsNamespace`, registered on the shared `ExtensionOptions` registry by [`@algorandfoundation/connections-core`](../core/README.md) so it is typed at the composition root). This package **augments** that interface with the browser-only `metadata` field; the `WebConnectionsOptions` type it exports is an alias of core's `ConnectionsOptions` (which moved from this package to core), so both names type the same options object.

| Option                   | Type                              | Default                                                                        | Description                                                                                                                      |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `connections.protocols`  | `ConnectionProtocol[]`            | `[]`                                                                           | Protocols the engine hosts (e.g. `liquidAuth({...})`); `connect` / `createRequest` / `resume` route through the registry. (core) |
| `connections.driver`     | `ConnectionKeyValueStore`         | `localStorageConnectionDriver()` (`memoryConnectionDriver()` when unavailable) | Two-method persistence driver for the sessions/messages snapshot. (core)                                                         |
| `connections.store`      | `Store<ConnectionsState>`         | fresh empty store                                                              | The reactive store the engine writes to. Pass your own to subscribe from the UI. (core)                                          |
| `connections.hooks`      | `HookCollection`                  | fresh collection                                                               | `before-after-hook` collection wrapping every store operation. (core)                                                            |
| `connections.storageKey` | `string`                          | `DEFAULT_CONNECTIONS_KEY`                                                      | Key the snapshot is persisted under. (core)                                                                                      |
| `connections.domains`    | `ConnectionDomains`               | inferred via `discoverDomains`                                                 | Connection domains announced during `connect`; override or extend the inferred set. (core)                                       |
| `connections.metadata`   | `{ name?: string; url?: string }` | `undefined`                                                                    | Display metadata of the dapp, sent with the `connect` handshake so the wallet can show who is asking. (**web augmentation**)     |

## License

Apache-2.0
