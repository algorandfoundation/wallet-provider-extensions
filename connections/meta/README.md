# 🔗 @algorandfoundation/connections

Meta package that resolves to the right platform connections engine and bundles the default protocols.

One install covers the connections domain: the `exports` map uses runtime/bundler conditions, exactly like [`@algorandfoundation/keystore`](../../keystore/meta), [`@algorandfoundation/identities`](../../identities/meta) and [`@algorandfoundation/credentials`](../../credentials/meta):

| Condition              | Resolves to                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `react-native` (Metro) | core + default protocols + responder-role `WithConnections` (react-native-connections) |
| `browser`              | core + default protocols + requester-role `WithConnections` (connections-web)          |
| `node` / default       | core + default protocols (no engine, so you must wire your own)                        |

Every condition re-exports [`@algorandfoundation/connections-core`](../core) (sessions, transport contract, wallet RPC, secure channel) and the **default protocols**, which currently include [`@algorandfoundation/connections-liquid-auth`](../liquid-auth)'s `liquidAuth` plug-in (`liquid://` QR requests, WebRTC signaling, seamless resume). Both usage modes are first-class from this one install: run the core primitives **standalone** (no Provider required), or mount the platform `WithConnections` extension for the Provider/Extensions pattern.

Unlike the other domains there is no per-platform _transport_ implementation baked into an engine: each provider specifies its own platform strategy through the protocols it registers. Under Metro the Liquid Auth re-export resolves through its own `react-native` condition, which prewires the protocol's `createSignalClient` seam to the vendored `react-native-liquid-auth` background `SignalService`.

## 📥 Installation

```bash
pnpm add @algorandfoundation/connections
```

## 🚀 Quick Start

### Provider integration

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithConnections, liquidAuth } from "@algorandfoundation/connections";

const MyProvider = Provider.withExtensions([WithConnections]);
const provider = new MyProvider(
  { id: "my-dapp", name: "My Dapp" },
  { connections: { protocols: [liquidAuth({ url: "https://liquid.example.com" })] } },
);

const session = await provider.connection.connect("liquid-auth");
```

### Standalone (no Provider)

The full core surface is re-exported on every condition, so the engine and the
default protocols compose directly:

```typescript
import { createConnectionsStore, liquidAuth } from "@algorandfoundation/connections";

const { api, protocols, ready } = createConnectionsStore({
  protocols: [liquidAuth({ url: "https://liquid.example.com" })],
});
await ready;

const requester = protocols.createRequester("liquid-auth", { sessions: api });
const request = await requester.createRequest();
renderQr(request.qrData);
const transport = await request.establish();
```

See the [core README](../core/README.md) for the full standalone primitive
surface (wallet responder, RPC, secure channel, messaging).

## ⚙️ Configuration

Whichever condition resolves, `WithConnections` reads the `options.connections` namespace (`ConnectionsNamespace`, registered on the shared `ExtensionOptions` registry by [`@algorandfoundation/connections-core`](../core/README.md)). The `browser` engine augments it with `metadata`; the `react-native` engine adds nothing. Core's `ConnectionsOptions` (re-exported here) types the whole block; the platform packages alias it as `WebConnectionsOptions` / `ReactNativeConnectionsOptions`.

| Option                   | Type                              | Default                                          | Description                                                                                        |
| ------------------------ | --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `connections.protocols`  | `ConnectionProtocol[]`            | `[]`                                             | Protocols the engine hosts, e.g. the bundled `liquidAuth({...})`. (core)                           |
| `connections.driver`     | `ConnectionKeyValueStore`         | `localStorage` (browser) / memory (react-native) | Two-method persistence driver for the sessions/messages snapshot. (core)                           |
| `connections.store`      | `Store<ConnectionsState>`         | fresh empty store                                | The reactive store the engine writes to. Pass your own to subscribe from the UI. (core)            |
| `connections.hooks`      | `HookCollection`                  | fresh collection                                 | `before-after-hook` collection wrapping every store operation. (core)                              |
| `connections.storageKey` | `string`                          | `DEFAULT_CONNECTIONS_KEY`                        | Key the snapshot is persisted under. (core)                                                        |
| `connections.domains`    | `ConnectionDomains`               | inferred via `discoverDomains`                   | Connection domains announced during `connect`; override or extend the inferred set. (core)         |
| `connections.metadata`   | `{ name?: string; url?: string }` | `undefined`                                      | Display metadata of the dapp sent with `connect`. (**`browser` only**, added by `connections-web`) |

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/connections/meta/).

## 📜 License

Apache-2.0
