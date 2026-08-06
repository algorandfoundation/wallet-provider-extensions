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
`options.keystore` block when no `api.keystore` backend is injected.

## Two engines: in-process and RPC

This package ships **two** ways to reach the same keystore:

1. **In-process** — `createNodeKeyStore` (above): the keystore runs directly
   inside your Node application.
2. **RPC** — a JSON-RPC 2.0 service over a **local socket** (a Unix domain
   socket, or a named pipe on Windows) that hosts a keystore, plus a drop-in
   **client engine** (`createRpcKeyStore`) third-party processes use to drive it
   as if it were in-process. No TCP port is opened; access is gated by
   filesystem permissions on the socket.

### Running the service

The service is meant to be run by the CLI, which owns the real OS-keychain
engine:

```sh
keystore serve                       # listen on the default socket
keystore serve --socket /tmp/ks.sock # or a custom path
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
carried transparently. These are also importable from the `./rpc` subpath.

Most applications should depend on the meta package
[`@algorandfoundation/keystore`](../meta/README.md) instead of importing this
package directly.

## License

Apache-2.0
