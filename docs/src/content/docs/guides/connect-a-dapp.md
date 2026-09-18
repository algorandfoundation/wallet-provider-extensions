---
title: "Connect a wallet and a dapp"
description: Establish a Liquid Auth session, resume it after restarts, and sign transactions over it.
sidebar:
  order: 5
---

This guide wires both ends of a connection: a dapp in the browser (the requester) and a wallet app (the responder). If you want the session model first, read [Connections](/concepts/connections/).

## 1. Set up the dapp side (requester)

In the browser, compose `WithConnections` with the Liquid Auth protocol and a connections store:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithConnections, liquidAuth } from "@algorandfoundation/connections";
import type { ConnectionsState } from "@algorandfoundation/connections";
import { Store } from "@tanstack/store";

const connectionsStore = new Store<ConnectionsState>({ sessions: [], messages: [] });

const DappProvider = Provider.withExtensions([WithConnections]);
const provider = new DappProvider(
  { id: "my-dapp", name: "My Dapp" },
  {
    connections: {
      store: connectionsStore,
      protocols: [liquidAuth({ url: "https://liquid.example.com" })],
    },
  },
);
```

## 2. Initiate a connection

Ask the protocol to connect and render the fallback QR for wallets that are not on the same device:

```typescript
const session = await provider.connection.connect("liquid-auth", {
  onFallback: (request) => renderQr(request.qrData), // shows the liquid:// URI
});

console.log(session.status); // "connected" once the wallet approves
console.log(session.peer?.domains.accounts); // records the wallet shared
```

The returned session already carries whatever the wallet exposed in the handshake: account records, identity records, credential and passkey metadata. Feed them into your domain stores through the remote mirrors and they behave like local records, scoped to this session.

## 3. Set up the wallet side (responder)

The wallet composes the same extension with the React Native engine and accepts scanned links:

```typescript
const WalletProvider = Provider.withExtensions([WithConnections /* , keystore, accounts... */]);
const wallet = new WalletProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    connections: {
      store: connectionsStore,
      protocols: [liquidAuth({ authSigner, wallet: walletSeams })],
    },
  },
);

// In the QR scanner handler:
await wallet.connection.accept(scannedUri); // the liquid:// URI from the dapp
```

The `wallet` seams tell the protocol which domain records to share in the handshake and how to answer signing requests. A wallet that composes the accounts and keystore extensions gets working seams almost for free, since the account records and the signer already exist.

## 4. Sign transactions over the session

From the dapp, send base64 msgpack transactions and get signed blobs back:

```typescript
const stxns = await provider.connection.signTransactions(
  session.id,
  txns, // base64-encoded unsigned transactions
  [0, 1], // indexes the wallet should sign; omit to sign all
);
// stxns: (string | null)[], null for entries the wallet skipped
```

The wallet approves or declines on its side; secrets never cross the wire, only signatures come back.

## 5. Resume after a restart

Sessions persist; transports do not. On startup, persisted sessions surface as `disconnected`. Render them immediately and resume in the background:

```typescript
for (const session of connectionsStore.state.sessions) {
  if (session.status === "disconnected") {
    provider.connection.resume(session.id).catch(() => {
      /* peer offline; the session stays disconnected until next attempt */
    });
  }
}
```

## 6. Exchange encrypted messages (optional)

For flows beyond signing, enable the secure channel on both sides and send text:

```typescript
provider.connection.enableSecureMessaging(session.id, {
  channel: createSecureChannel({ privateKey, remotePublicKey }),
  onMessage: (msg) => console.log("received:", msg.text),
});

await provider.connection.sendSecureMessage(session.id, "hello wallet");
```

Messages are X25519/XChaCha20-Poly1305 encrypted and tracked in the `messages` store with per-message delivery status.

## 7. Disconnect

```typescript
await provider.connection.disconnect(session.id);
```

Disconnecting ends the transport and marks the session `disconnected`. Revoke the session's mirrored records in each domain store to remove what the peer shared.

## Related

- [Connections](/concepts/connections/) for sessions, protocols, and the handshake.
- [Integrate with use-wallet](/guides/integrate-use-wallet/) to put a standard dapp API on top of this.
