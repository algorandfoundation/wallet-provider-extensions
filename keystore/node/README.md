# @algorandfoundation/keystore-node

The Node.js / server entry point for the Wallet Provider Keystore.

All of the cryptographic implementation — the composable Subtle shims and the
shared, platform-neutral `createKeyStore` engine — lives in
[`@algorandfoundation/keystore-core`](../core/README.md), which this package
re-exports (types, errors, shims, constants and the engine). On top of it, this
package ships an **OS-keychain storage engine** — the server counterpart to the
IndexedDB engine in [`@algorandfoundation/keystore-web`](../web/README.md).

## Universal by design

The core implementation relies only on the universal `globalThis.crypto`
(`crypto.subtle` / `crypto.getRandomValues`) and pure-JS primitives, so it runs
unchanged in Node and other server runtimes.

## OS-keychain engine

`createNodeKeyStore` implements the `KeyStoreAPI` on top of the operating-system
keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service /
libsecret via [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring)):

- **Secret material is stored directly in the keychain**, relying on its
  encryption at rest — no extra app-level cipher over the material. Oversized
  material (notably Falcon-1024 private keys, which exceed the ~2.5 KB Windows
  Credential Manager per-entry cap) is transparently **chunked** across numbered
  keychain entries and reassembled on read.
- **All key metadata is kept in a single AES-GCM sealed file** (default
  `~/.algorand-keystore/metadata.bin`), keyed by a small master key held in the
  keychain — so metadata has no per-entry size limit and never leaks in plaintext
  at rest. The reactive store mirrors only UI-safe metadata.

`@napi-rs/keyring` is an **optional** dependency and is loaded lazily, so it is
only required when you use the default keyring. The `keyring` and `metadata`
seams are injectable, so tests (or alternative secure stores) can supply their
own bindings.

```typescript
import { Store } from "@tanstack/store";
import { createNodeKeyStore } from "@algorandfoundation/keystore-node";

const store = new Store({ keys: [], status: "idle" });
const keystore = createNodeKeyStore({ store }); // uses the OS keychain
await keystore.ready;

const id = await keystore.generate({
  type: "ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign", "verify"],
});
const signature = await keystore.sign(id, new TextEncoder().encode("hi"));
```

A `WithKeyStore` Provider/Extensions wrapper is also exported (parity with the
browser and React Native packages) and builds the engine from the
`options.keystore` block when no `api.keystore` backend is injected. It mounts
at `provider.key.store` unless `options.keystore.mount` names another path — see
[Several keystores on one provider](#several-keystores-on-one-provider).

## Two engines: in-process and remote

This package ships **two** ways to reach the same keystore:

1. **In-process** — `createNodeKeyStore` (above): the keystore runs directly
   inside your Node application.
2. **Remote** — a JSON-RPC 2.0 **daemon** that hosts a keystore, plus a drop-in
   **client engine** other processes use to drive it as if it were in-process.

The protocol, the client engine and the host-side responder are the pure,
transport-neutral
[`@algorandfoundation/keystore-remote`](../remote/README.md) package; this one
adds the Node listeners and the local-socket transport. See the
[remote example](../../examples/node-keystore-remote) for a daemon and a
consumer talking to each other.

### Running the service

The service is meant to be run by the CLI, which owns the real OS-keychain
engine:

```sh
keystore serve                       # listen on the default socket
keystore serve --socket /tmp/ks.sock # or a custom path
keystore serve --ws --port 7413      # also serve a WebSocket, for remote consumers
keystore serve --ws --socket ""      # WebSocket only
```

Programmatically, `createKeyStoreRpcServer` hosts any `KeyStore`:

```typescript
import { Store } from "@tanstack/store";
import { createNodeKeyStore, createKeyStoreRpcServer } from "@algorandfoundation/keystore-node";

const store = new Store({ keys: [], status: "idle", algorithms: [] });
const keystore = createNodeKeyStore({ store });
const server = createKeyStoreRpcServer({ keystore, store });
const path = await server.listen();
console.log(`keystore RPC listening on ${path}`);
```

### Reaching the daemon: transports

The daemon and the client agree on a protocol, not on a pipe. Which transport
carries it is a deployment choice:

| Transport                       | Reach        | Serve with                      | Connect with                                  |
| ------------------------------- | ------------ | ------------------------------- | --------------------------------------------- |
| Unix domain socket / named pipe | same machine | `createKeyStoreRpcServer`       | `createRpcKeyStore` / `createSocketTransport` |
| WebSocket                       | anywhere     | `createKeyStoreWebSocketServer` | `createWebSocketTransport`                    |

The local socket is the safe default: no TCP port is opened and access is gated
by filesystem permissions. A WebSocket is what lets you spin the daemon up and
connect to it from a _remote_ consumer — a wallet, a web page, another service:

```typescript
import { Store } from "@tanstack/store";
import {
  createNodeKeyStore,
  createKeyStoreWebSocketServer,
} from "@algorandfoundation/keystore-node";

const store = new Store({ keys: [], status: "idle", algorithms: [] });
const keystore = createNodeKeyStore({ store });
const server = createKeyStoreWebSocketServer({ keystore, store, port: 7413 });
console.log(`keystore listening on ${await server.listen()}`); // ws://127.0.0.1:7413
```

The listener uses [`ws`](https://www.npmjs.com/package/ws), an **optional**
dependency loaded lazily — like `@napi-rs/keyring` — so the package stays
installable for anyone who only wants the local socket. It binds `127.0.0.1` and
adds no authentication of its own: before exposing it beyond loopback, put TLS
in front of it (`wss://`) and host a keystore that authenticates every call
through its per-operation context, which is exactly what the OWS adapter below
does.

On the consumer side the engine is the same either way; only the transport
changes:

```typescript
import {
  createRemoteKeyStore,
  createWebSocketTransport,
} from "@algorandfoundation/keystore-remote";

const keystore = createRemoteKeyStore({
  store,
  transport: createWebSocketTransport({ url: "ws://127.0.0.1:7413" }),
});
```

### Several keystores on one provider

A remote keystore usually joins a provider that already has a local one, so
keystores are **namespaced**. Each extension takes a _mount_ — a dot-separated
path under `provider.key`, defaulting to `"store"` — and folds itself into the
namespace the provider already carries instead of replacing it:

```typescript
import { WithKeyStore } from "@algorandfoundation/keystore-node";
import { withRemoteKeyStoreAt } from "@algorandfoundation/keystore-remote";

const WalletProvider = Provider.withExtensions([
  WithKeyStore, // the OS keychain keeps `key.store`
  withRemoteKeyStoreAt("rpc.ows"), // the daemon becomes `key.rpc.ows`
]);

const provider = new WalletProvider(
  { id: "wallet", name: "Wallet" },
  {
    keystore: { store: localStore, hooks },
    remote: { "rpc.ows": { store: remoteStore, transport } },
  },
);

await provider.key.store.sign(localId, bytes); // signed on this machine
await provider.key.rpc.ows.sign(vaultId, bytes); // signed by the daemon's vault
```

The mount path is reflected in the type, so `provider.key.rpc.ows` is checked
like any other member. Give each keystore its **own** reactive store; the first
one to mount owns the provider's top-level `keys`/`status`/`algorithms`, and a
name that is already answered raises `KeyStoreMountError` rather than being
silently overwritten. `WithKeyStore` and `WithOwsKeyStore` take the same option
as `options.keystore.mount`, so two local custodians can coexist the same way.
The machinery is shared and lives in `keystore-core` (`mountKeyStore`,
`createKeyStoreExtension`).

### The drop-in client engine

`createRpcKeyStore` implements the full `KeyStore` contract by forwarding every
call over the socket, so it is interchangeable with the in-process engine — pass
it to the extension via `options.api.keystore`. The client's reactive `store` is
kept hydrated by the service's state pushes (so `keys`/`algorithms` work
remotely):

```typescript
import { Store } from "@tanstack/store";
import { createRpcKeyStore } from "@algorandfoundation/keystore-node";

const store = new Store({ keys: [], status: "idle", algorithms: [] });
const keystore = createRpcKeyStore({ store }); // connects to the default socket
await keystore.ready;

const id = await keystore.generate({
  type: "ed25519",
  algorithm: "EdDSA",
  extractable: false,
  keyUsages: ["sign", "verify"],
});
const signature = await keystore.sign(id, new TextEncoder().encode("hi"));
await keystore.close();
```

The RPC surface exposes the whole `KeyStoreAPI` (including the `secrets`
namespace). `Uint8Array` payloads (signatures, public keys, seed bytes) are
carried transparently, as is the per-operation context — so a keystore that
authenticates every call can be driven remotely. These are also importable from
the `./rpc` subpath.

## Open Wallet Standard (OWS) adapter

A third custodian is available: an [Open Wallet Standard](https://openwallet.sh/)
vault. OWS keeps the seed, evaluates its policy engine and signs; this package
keeps its own abstraction — the reactive store, the extension surface and the
`KeyStoreAPI` — and simply binds them to the OWS node. Importable from the
`./ows` subpath (or the package root).

`createOwsKeyStore` is a drop-in engine, exactly like `createRpcKeyStore`: it
owns no material and therefore drives no storage driver.

```typescript
import { Store } from "@tanstack/store";
import { createOwsKeyStore } from "@algorandfoundation/keystore-node/ows";

const store = new Store({ keys: [], status: "idle" });
const keystore = createOwsKeyStore({
  store,
  passphrase: process.env.OWS_PASSPHRASE, // owner passphrase or `ows_key_…` agent token
});
await keystore.ready;

// One key per OWS wallet account: `ows/<walletId>/<chainId>`
const [account] = store.state.keys;
console.log(account.metadata); // { chain: "evm", address: "0x…", derivationPath: "m/44'/60'/0'/0/0", … }

const signature = await keystore.sign(account.id, txBytes, "transaction");
```

How the two models line up:

| Keystore            | OWS                                                           |
| ------------------- | ------------------------------------------------------------- |
| `keys`              | one entry per wallet **account** (`ows/<walletId>/<chainId>`) |
| `generate`          | `createWallet` (new mnemonic, all chain accounts)             |
| `import`            | `importWalletMnemonic` / `importWalletPrivateKey`             |
| `sign`              | `signMessage` (default), `signTransaction`, `signHash`        |
| `remove` / `clear`  | `deleteWallet` (a wallet is the unit of deletion)             |
| per-operation `ctx` | the OWS credential: owner passphrase or `ows_key_…` API token |
| `export`            | `exportWallet`, refused unless `allowExport` is set           |
| `verify`            | **unsupported** — OWS has no verification operation           |

Two OWS access profiles are supported and picked automatically
(`resolveOwsBinding`), or selected explicitly:

- `createOwsNativeBinding` — the in-process NAPI bindings
  ([`@open-wallet-standard/core`](https://www.npmjs.com/package/@open-wallet-standard/core)),
  loaded dynamically so the package stays an optional peer.
- `createOwsCliBinding` — the `ows` binary, one subprocess per operation.
  Secrets go over stdin and the credential over `OWS_PASSPHRASE`, never argv.

Both implement the same `OwsBinding` seam, so a local service (or a test fake)
can be dropped in without touching the engine. OWS denials (`POLICY_DENIED`,
`INVALID_PASSPHRASE`, …) are surfaced as `OwsError` with the canonical code —
never softened into a success — and an unknown wallet becomes the familiar
`KeyNotFoundError`.

A `WithOwsKeyStore` extension mirrors `WithKeyStore`, so swapping custody for
OWS is a change of extension, not of application code:

```typescript
const provider = new ProviderWithOws(
  { id: "agent", name: "Agent" },
  { keystore: { store, hooks, passphrase: process.env.OWS_TOKEN } },
);
```

It is mounted like every other keystore, so `mount: "ows"` puts the vault at
`provider.key.ows` and leaves `provider.key.store` to a local custodian.

Most applications should depend on the meta package
[`@algorandfoundation/keystore`](../meta/README.md) instead of importing this
package directly.

## License

Apache-2.0
