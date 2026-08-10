# @algorandfoundation/keystore-remote

The keystore **across a boundary**.

The other keystore packages answer _where does the material live?_ — the OS
keychain ([node](../node/README.md)), IndexedDB ([web](../web/README.md)), the
platform secure enclave ([react-native](../react-native/README.md)), an OWS
vault. This one answers a different question: **the keystore is somewhere else,
how do I talk to it?**

It ships four things and nothing else:

- the **JSON-RPC 2.0 protocol** the keystore speaks on a wire,
- `createRemoteKeyStore` — a drop-in client engine implementing the whole
  `KeyStore` contract by forwarding every call,
- `createKeyStoreResponder` — the host half that answers those calls for an
  already-built keystore,
- `WithRemoteKeyStore` / `withRemoteKeyStoreAt` — the Provider extension that
  mounts a remote keystore under a name of its own (`provider.key.rpc.ows`),
  next to whatever keystores the provider already has.

It is deliberately **pure**: no Node built-ins (bytes travel base64 via
`btoa`/`atob`, not `Buffer`), no DOM assumptions beyond the standard
`WebSocket`. The same client runs in a web page, a wallet, a worker or another
service.

## The transport seam

A `RemoteTransport` is the single place a runtime enters. It moves opaque
frames and reports when the link drops — that is the entire contract:

```typescript
type RemoteTransport = (handlers: RemoteChannelHandlers) => RemoteChannel;
```

Three implementations exist today, and the protocol cannot tell them apart:

| Transport                                                                      | Reach        | Ships in        |
| ------------------------------------------------------------------------------ | ------------ | --------------- |
| `createWebSocketTransport`                                                     | anywhere     | this package    |
| `createLoopbackTransport`                                                      | same process | this package    |
| [`createSocketTransport`](../node/README.md) (Unix domain socket / named pipe) | same machine | `keystore-node` |

## Driving a remote keystore

```typescript
import { Store } from "@tanstack/store";
import {
  createRemoteKeyStore,
  createWebSocketTransport,
} from "@algorandfoundation/keystore-remote";

const store = new Store({ keys: [], status: "idle", algorithms: [] });
const keystore = createRemoteKeyStore({
  store,
  transport: createWebSocketTransport({ url: "ws://127.0.0.1:7413" }),
});
await keystore.ready;

// The daemon pushed its state on connect, so the store is already hydrated.
const [key] = store.state.keys;
const signature = await keystore.sign(key.id, new TextEncoder().encode("hi"));
await keystore.close();
```

Because it satisfies the same contract as an in-process engine, it is
interchangeable with one: pass it to a keystore extension as
`options.api.keystore` and application code never learns that the keystore is
elsewhere. `ready` resolves on the first state snapshot; from then on the
service's `state` notifications keep the reactive store hydrated, so
`keys` / `status` / `algorithms` work remotely without polling.

Two things deliberately survive the boundary:

- **The per-operation context.** `sign(id, data, algorithm, ctx)` carries `ctx`
  to the host, so a keystore that authenticates every call — the OWS adapter's
  credential, a biometric prompt — can be driven remotely.
- **Failures.** A host-side error is re-thrown on the caller's side with the
  host's message; a denial is never softened into a success, and an unsupported
  operation says so instead of doing nothing.

## On a provider: naming the keystore

A remote keystore rarely arrives alone — it joins a provider that already has a
local one. So it is **namespaced**: a _mount_ decides which name it answers to
under `provider.key`, and the extension folds itself into whatever is already
there instead of replacing it.

`WithRemoteKeyStore` mounts at `provider.key.store` by default, so it is a
drop-in replacement for a platform keystore:

```typescript
import { WithRemoteKeyStore } from "@algorandfoundation/keystore-remote";

const RemoteProvider = Provider.withExtensions([WithRemoteKeyStore]);
const provider = new RemoteProvider(
  { id: "wallet", name: "Wallet" },
  { remote: { store, transport, mount: "rpc" } }, // omit `mount` for `key.store`
);

await provider.key.rpc.ready;
```

`withRemoteKeyStoreAt` fixes the mount **in the type**, so a named service is as
type-safe as `key.store` — and several of them can sit under one group:

```typescript
import { withRemoteKeyStoreAt } from "@algorandfoundation/keystore-remote";
import { WithKeyStore } from "@algorandfoundation/keystore-node";

const WalletProvider = Provider.withExtensions([
  WithKeyStore, // the local keystore keeps `key.store`
  withRemoteKeyStoreAt("rpc.ows"),
  withRemoteKeyStoreAt("rpc.hsm"),
]);

const provider = new WalletProvider(
  { id: "wallet", name: "Wallet" },
  {
    keystore: { store: localStore, hooks },
    remote: {
      "rpc.ows": { store: owsStore, transport: owsTransport },
      "rpc.hsm": { store: hsmStore, transport: hsmTransport },
    },
  },
);

await provider.key.store.sign(localId, bytes); // local
await provider.key.rpc.ows.sign(vaultId, bytes); // the OWS daemon
```

Three rules keep this predictable:

- **Every keystore gets its own reactive store**; sharing one would have them
  overwrite each other's `keys`.
- **The first keystore to mount owns the provider's top-level reactive state**
  (`provider.keys` / `status` / `algorithms`). A keystore mounted alongside it
  leaves that alone — its own state is read from the store it was given.
- **A taken name is an error**, not a silent overwrite: mounting twice at the
  same path throws `KeyStoreMountError`.

The mount itself is shared machinery, not a remote-only idea: it lives in
`@algorandfoundation/keystore-core` (`mountKeyStore`,
`createKeyStoreExtension`), and every platform extension accepts
`options.keystore.mount` for the same reason.

## Hosting one

```typescript
import { createKeyStoreResponder } from "@algorandfoundation/keystore-remote";

const responder = createKeyStoreResponder({ keystore, store });

// …once a peer connects, on whatever transport:
const session = responder.open({
  send: (frame) => socket.send(frame),
  close: () => socket.close(),
});
socket.on("message", (data) => session.receive(String(data)));
socket.on("close", () => session.close());
```

The responder has no transport of its own, which is what lets one keystore be
published over a Unix socket and a WebSocket at once, with identical behaviour.
`@algorandfoundation/keystore-node` ships both listeners
(`createKeyStoreRpcServer`, `createKeyStoreWebSocketServer`) on top of it.

## On the wire

Newline-delimited JSON-RPC 2.0. One frame per message, so a stream transport can
treat it as NDJSON and a message transport can send it as one text frame:

```json
{"jsonrpc":"2.0","id":1,"method":"sign","params":["key-1",{"$bytes":"aGk="},null,null]}
{"jsonrpc":"2.0","id":1,"result":{"$bytes":"3q2+7w=="}}
{"jsonrpc":"2.0","method":"state","params":[{"keys":[],"status":"idle"}]}
```

JSON has no byte type, so every `Uint8Array` (signatures, public keys, seed
bytes) travels as a `{"$bytes": base64}` envelope and is re-materialized on
arrival. `RPC_METHODS` is the whole `KeyStoreAPI` — including the `secrets.*`
namespace — and doubles as the responder's allow-list, so nothing outside it is
ever dispatched.

## Security

This package moves calls; it does not secure the link. A WebSocket exposed
beyond loopback must be `wss://`, and the keystore behind it should authenticate
every call through the per-operation context rather than trusting the
connection.

## License

Apache-2.0
