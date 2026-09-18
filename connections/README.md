# Connections

Remote dapp ↔ wallet connections for Wallet Provider Extensions, built as a
**protocol plug-in architecture**:

| Package                                        | Role                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@algorandfoundation/connections`              | The **meta package**: re-exports the core plus the bundled default protocols (Liquid Auth) from every condition, and resolves to the platform `WithConnections` engine (`browser` → web requester, `react-native` → responder).                                                                    |
| `@algorandfoundation/connections-core`         | The contracts everything compiles against: sessions + messages store engine, `ConnectionTransport`, the wallet RPC (`connect`, `sign_transactions`, `message`, `message_ack`), the wallet responder, the identity-key secure channel + messaging layer, and the `ConnectionProtocol` plug-in seam. |
| `@algorandfoundation/connections-liquid-auth`  | The Liquid Auth protocol: WebRTC signaling via `@algorandfoundation/liquid-client`, `liquid://` QR establishment, responder auth + wallet RPC.                                                                                                                                                     |
| `@algorandfoundation/connections-web`          | The browser (dapp-side, requester-role) `WithConnections` engine.                                                                                                                                                                                                                                  |
| `@algorandfoundation/react-native-connections` | The React Native (wallet-side, responder-role) `WithConnections` engine.                                                                                                                                                                                                                           |

## Protocol plug-ins

The platform engines carry **zero protocol logic**. Applications opt into
protocols per connection:

```ts
// Dapp (browser): the meta package's `browser` condition resolves the
// requester engine and bundles the default protocols in one import.
import { WithConnections, liquidAuth } from "@algorandfoundation/connections";

const provider = new DappProvider(config, {
  connections: { protocols: [liquidAuth({ url: "https://liquid.example.com" })] },
});
const session = await provider.connection.connect("liquid-auth", {
  onFallback: (request) => renderQr(request.qrData),
});
```

```ts
// Wallet (React Native): the `react-native` condition resolves the
// responder engine; the Liquid Auth re-export also carries the native
// signaling seam (`nativeSignalClientFactory`, backed by the vendored
// `react-native-liquid-auth` module under `liquid-auth/vendor`).
import { WithConnections, liquidAuth } from "@algorandfoundation/connections";

// The connect inventory exchange is NOT configured here: the engine
// infers the connection domains (accounts, identities, passkeys,
// credentials) from the provider's mounted store extensions.
const provider = new WalletProvider(config, {
  connections: {
    protocols: [
      liquidAuth({
        authSigner,
        wallet: {
          signTransactions,
          approveConnect,
          approveSignTransactions,
        },
      }),
    ],
  },
});
await provider.connection.accept(uri); // the scanned liquid:// QR
```

A future WalletConnect or Matrix protocol is a sibling package exporting the
same `ConnectionProtocol` shape (`id` + `createRequester` / `createResponder`
factories), and both engines host it without changes.

## Configuration

Both engines read the `options.connections` namespace. The platform-neutral
fields are declared by `ConnectionsNamespace` in
`@algorandfoundation/connections-core`, which registers `connections` on the
shared `ExtensionOptions` registry (so it is typed at the composition root);
`@algorandfoundation/connections-web` augments the same interface with the
browser-only `metadata`, and `@algorandfoundation/react-native-connections`
adds nothing. `ConnectionsOptions` now lives in core (it used to be exported by
`connections-web`); the platform packages expose it as the
`WebConnectionsOptions` / `ReactNativeConnectionsOptions` aliases.

| Option                   | Type                              | Default                                      | Description                                                                                                                               |
| ------------------------ | --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `connections.protocols`  | `ConnectionProtocol[]`            | `[]`                                         | Protocols the engine hosts (e.g. `liquidAuth({...})`); `connect` / `accept` / `resume` route through the `ProtocolRegistry`. (core)       |
| `connections.driver`     | `ConnectionKeyValueStore`         | `localStorage` (web) / memory (react-native) | Two-method persistence driver for the sessions/messages snapshot. (core)                                                                  |
| `connections.store`      | `Store<ConnectionsState>`         | fresh empty store                            | The reactive store the engine writes to. Pass your own to subscribe from the UI. (core)                                                   |
| `connections.hooks`      | `HookCollection`                  | fresh collection                             | `before-after-hook` collection wrapping every store operation. (core)                                                                     |
| `connections.storageKey` | `string`                          | `DEFAULT_CONNECTIONS_KEY`                    | Key the snapshot is persisted under (`"@algorandfoundation/connections"`). (core)                                                         |
| `connections.domains`    | `ConnectionDomains`               | inferred via `discoverDomains`               | Connection domains announced during `connect`; pass an explicit `defineDomain({...})` list to override or extend the inferred set. (core) |
| `connections.metadata`   | `{ name?: string; url?: string }` | `undefined`                                  | Display metadata of the dapp, sent with the `connect` handshake. (**web augmentation**)                                                   |

## Identities, passkeys, and credentials over the pipe

The `connect` handshake carries more than accounts: it exchanges **connection
domains**. Each engine infers its domains from the provider surface at
handshake time (`discoverDomains` in the core); every mounted store extension
(`provider.account.store`, `provider.identity.store`, `provider.passkey.store`,
`provider.credential.store`) announces its domain through the session-scoped
`remote` mirror the extension mounts next to the store (e.g.
`provider.identity.remote`). Apps declare nothing or pass an explicit
`connections.domains` list (`defineDomain({...})`) to override the inference.
The peer's records land on `session.peer.domains`, keyed by domain id
(`accounts`, `identities`, `passkeys`, `credentials`), and each domain's
`remote` mirror feeds them into its own store for the lifetime of the session
(received on connect, revoked again on disconnect).

**Data only**: records travel the wire as their JSON-safe projections.
identities as `IdentityRecord` (the identity minus `sign`; the receiving side
re-attaches a session-routed signer), passkeys as their public descriptors
(key material never crosses the wire) and credentials as presentation metadata
(raw payloads and claims stay in the wallet; disclosure remains a deliberate
OID4VP flow). Because the inventory persists with the session record, a
third-party app can keep presenting what the wallet holds for future access
even when the transport is down, so no re-scan is needed to know a credential
exists.

## The `liquid://` QR flow

The QR code in Liquid Auth moves `{ origin, requestId }` out-of-band:
the dapp's `connect()` creates the pending request and surfaces it via
`onFallback` (render `request.qrData` as a QR), the wallet scans it and
calls `provider.connection.accept(uri)`, both sides meet in the same
signaling room, and the WebRTC data channel carries the `ConnectionRpc`
(`connect` / `sign_transactions`) until either side disconnects.

## Secure messaging (informal)

Once `connect` exchanged the peers' `did:key` identities, each side reads
the other's X25519 key from the DID document's `keyAgreement` section and
derives the SAME symmetric key (X25519 ECDH → HKDF-SHA256), so messages
travel the transport as XChaCha20-Poly1305 ciphertext only:

```typescript
import {
  createSecureChannel,
  createSecureMessaging,
  keyAgreementPublicKey,
  x25519KeyPairFromEd25519Seed,
} from "@algorandfoundation/connections-core";

const channel = createSecureChannel({
  privateKey: x25519KeyPairFromEd25519Seed(identitySeed).privateKey,
  remotePublicKey: keyAgreementPublicKey(peerIdentity.didDocument!)!,
});
const messaging = createSecureMessaging({ rpc, channel, sessionId, messages: api });
messaging.attach(responderHandler); // compose with connect/sign handling
await messaging.send("hello"); // pending → delivered → acknowledged
```

Every message is persisted in the connections store on both sides
(surviving restarts), and the ack process is two-step: the rpc response
is the delivery receipt (`delivered`). An explicit `message_ack`, which is
automatic by default or application-gated via `autoAcknowledge: false`,
upgrades it to `acknowledged`. This contract is deliberately INFORMAL: a
proper messaging spec will replace it.

Both engines wire this up end to end:

- **Dapp (browser)**: the identities domain introduces the dapp's
  identities with the `connect` handshake (their DID documents carry the
  `keyAgreement` keys), and the connection API drives the channel:
  `enableSecureMessaging(sessionId, { channel, onMessage })` registers it
  (re-attached automatically after a resume) and
  `sendSecureMessage(sessionId, text)` seals and sends.
- **Wallet (liquid-auth responder)**: the `messaging` option composes the
  layer with the wallet responder: `channel(peer)` derives the session's
  `SecureChannel` from the identities the dapp introduced
  (`peer.domains.identities`; return `null` to keep messaging off, as
  `message` then rejects with
  `secure_channel_unavailable`), `onMessage(message, actions)` surfaces
  each decrypted message to the user (e.g. a native alert), and with
  `autoAcknowledge: false` the ack waits for `actions.acknowledge()`,
  the user's explicit receipt.

## use-wallet integration

The `ProviderAdapter` in `examples/use-wallet-client`
(`src/lib/provider/adapter.ts` + `src/lib/provider/provider.ts`) exposes the
whole stack to use-wallet v5 dapps as a single adapter; copy it into your
dapp and adjust as needed. The adapter constructs and carries an official
`@algorandfoundation/wallet-provider` Provider with the connections engine
plus the accounts (`@algorandfoundation/accounts-core`), identities
(`@algorandfoundation/identities-core`), passkeys and credentials stores
mounted; the wallet entry is the `dappWallet()` factory, shaped like every
other use-wallet factory:

```ts
import { dappWallet } from "./lib/provider/adapter.ts";

const manager = new WalletManager({
  wallets: [dappWallet(), pera(), lute()],
});
```

`wallet.connect()` runs the `liquid://` QR flow; `signTransactions()` routes
encoded/decoded groups through the connection RPC as base64 msgpack. The
wallet's domain records ride the same connect handshake
(`session.peer.domains`) and are fed into the mounted domain stores through
their `remote` mirrors for the session's lifetime; the panels read the
domain stores, never the connections store.

## Demo pair

- `examples/use-wallet-client` (the dapp): use-wallet + `ProviderAdapter`, QR
  connection panel.
- `examples/react-native-wallet` (the wallet): responder engine, connections
  screen with QR scanning + approval dialogs.

Both default to the public `https://debug.liquidauth.com` signaling service.

## Testing

Every package tests headlessly: `createInMemoryTransportPair` (core) covers the
RPC layer and `createMockSignaling` (liquid-auth) covers signaling/peering. No
native host or network is required for `pnpm test`.
