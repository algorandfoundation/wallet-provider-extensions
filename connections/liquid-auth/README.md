# @algorandfoundation/connections-liquid-auth

The **Liquid Auth connection protocol**, which includes `liquid://` QR requests, WebRTC
signaling and transport, and seamless session resume, implemented as a `ConnectionProtocol`
plug-in. It runs equally in both usage modes: **standalone** against the core
engine (`createConnectionsStore` of
[`@algorandfoundation/connections-core`](../core), no Provider required) and as
the protocol behind the platform `WithConnections` Wallet Provider Extensions.

Signaling runs over `@algorandfoundation/liquid-client` against a
[Liquid Auth](https://github.com/algorandfoundation/liquid-auth) service: the
dapp renders a `liquid://` QR, the wallet scans it, authenticates against the
signaling origin (liquid-auth WebAuthn attestation with an Algorand-signed
challenge) and offers a WebRTC connection; both sides then talk the wallet RPC
of [`@algorandfoundation/connections-core`](../core) over the negotiated data
channel. Both roles implement the optional `resume` seam: once a session has
paired, either party can rejoin the signaling room and renegotiate the
transport without requiring a new QR scan or a new WebAuthn ceremony.

This protocol is bundled as a default by the meta package
[`@algorandfoundation/connections`](../meta/README.md).

## Installation

```bash
pnpm add @algorandfoundation/connections-liquid-auth
```

Optional peer dependencies: `react-native-liquid-auth` (backs the native
signaling seam under the `react-native` export condition; see below) and
`@algorandfoundation/logs` (engine logging through `provider.log`).

## Usage

`liquidAuth(options)` returns the protocol, ready for an engine's
`protocols: [...]` option, regardless of whether that engine is the standalone core engine
or a platform `WithConnections` extension. The requester role is available when
`url` is set (the dapp must know its signaling origin); the responder role is
always available (the origin arrives inside the `liquid://` URI).

### Standalone (core engine)

Register the protocol with `createConnectionsStore` and drive either role
through the returned registry, without involving a Provider:

```typescript
import { createConnectionRpc, createConnectionsStore } from "@algorandfoundation/connections-core";
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";

const { api, protocols, ready } = createConnectionsStore({
  protocols: [liquidAuth({ url: "https://liquid.example.com" })],
});
await ready;

const requester = protocols.createRequester("liquid-auth", { sessions: api });
const request = await requester.createRequest();
renderQr(request.qrData);

const transport = await request.establish();
const rpc = createConnectionRpc(transport);
const result = await rpc.request("connect", { metadata: { name: "My Dapp" } });
```

The role factories are also exported directly (`createLiquidAuthRequester` /
`createLiquidAuthResponder` (see [Key Exports](#key-exports)) for hosts that
bypass the registry.

### Provider integration (`WithConnections`)

Dapp side (requester), with the browser engine of
[`@algorandfoundation/connections-web`](../web):

```typescript
import { liquidAuth } from "@algorandfoundation/connections-liquid-auth";
import { WithConnections } from "@algorandfoundation/connections-web";
import { Provider } from "@algorandfoundation/wallet-provider";

const MyProvider = Provider.withExtensions([WithConnections]);
const provider = new MyProvider(
  { id: "my-dapp", name: "My Dapp" },
  { connections: { protocols: [liquidAuth({ url: "https://liquid.example.com" })] } },
);

const session = await provider.connection.connect("liquid-auth", {
  onFallback: (request) => renderQr(request.qrData),
});
```

Wallet side (responder), with the React Native engine of
[`@algorandfoundation/react-native-connections`](../react-native):

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
    },
  },
);

await provider.connection.accept(scannedLiquidUri);
```

## Key Exports

- [**`liquidAuth`** / **`LIQUID_AUTH_PROTOCOL_ID`**](./src/index.ts): The protocol factory (the union of both roles' options) and the `"liquid-auth"` id applications opt in by.
- [**`createLiquidAuthRequester`**](./src/requester.ts): The dapp-side role: `createRequest()` generates the request id and the `liquid://` QR payload, `establish()` joins the signaling room and answers the wallet's WebRTC offer, `resume()` parks on the session's rendezvous until the wallet re-offers.
- [**`createLiquidAuthResponder`**](./src/responder.ts): The wallet-side role: parses the scanned URI, authenticates against the signaling origin (an `authSigner` seam signs the service challenge; `authenticate` overrides the whole step), offers the WebRTC connection and attaches the core `createWalletResponder` (plus the optional `messaging` secure-messaging seam) over the established transport.
- [**`buildLiquidUri`** / **`parseLiquidUri`**](./src/uri.ts): The `liquid://<host>/?requestId=<uuid>` request URI, representing the out-of-band (QR / deep-link) path.
- [**`dataChannelTransport`**](./src/channel.ts): Wraps a negotiated WebRTC data channel as a core `ConnectionTransport`.
- [**Address helpers**](./src/address.ts): `encodeAlgorandAddress`, `decodeAlgorandAddress`, `isAlgorandAddress` and `toAlgorandAddress`, which are used to normalize the `authSigner` result before it goes on the wire.
- [**`fetchAssertionOptions`**](./src/assertionOptions.ts): Fetches the WebAuthn assertion request options for a credential id from the signaling origin (surfaced to hosts via the responder's `onAssertionOptions` seam).
- [**`LiquidAuthError`**](./src/errors.ts): The protocol error with a stable `code` (`invalid_uri`, `invalid_address`, `establish_failed`, `aborted`, …).
- [**Signaling & testing seams**](./src/signaling.ts): The `LiquidSignalClient` contract with `defaultSignalClientFactory` (the `SignalClient` of liquid-client), plus [mock helpers](./src/mock.ts) for tests.

## React Native

Under Metro the `react-native` export condition resolves to the full
platform-neutral surface **plus** the native signaling seam of
`react-native-liquid-auth` (an optional peer): the
[`nativeSignalClientFactory`](./src/nativeModule.ts) adapter runs signaling and
authentication through the module's background `SignalService`, prewired to the
responder's `createSignalClient` option.

```typescript
import { liquidAuth, nativeSignalClientFactory } from "@algorandfoundation/connections-liquid-auth";

const protocol = liquidAuth({
  createSignalClient: nativeSignalClientFactory(),
  wallet: { signTransactions },
});
```

Authentication against the liquid-auth service is a native concern on this
path (the module's cookie-jar `request()` shares its session with the
background socket), so hosts either authenticate natively beforehand or pass an
`authenticate` override. When the module cannot be resolved automatically,
inject it explicitly via `createNativeSignalClientFactory(module)`.

## License

Apache-2.0
