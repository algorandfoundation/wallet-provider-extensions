---
title: "Connections"
description: How wallets and dapps find each other, stay paired, and exchange state and signatures.
sidebar:
  order: 7
---

Everything else in this documentation runs inside one process. Connections are where the wallet meets the outside world: a dapp in a browser asking a wallet on a phone to share accounts and sign transactions. This page explains the session model and the moving parts; [Connect a wallet and a dapp](/guides/connect-a-dapp/) walks through the code.

Like every package in this repo, connections work standalone, as the `createConnectionsStore` engine factory does not require a Provider (see the [connections-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/connections/core#readme)), while `WithConnections` provides first-class Provider integration.

## Two roles

Every connection has a **requester** and a **responder**:

- The **requester** is usually a dapp. It initiates: it asks a protocol for a connection, renders a QR code or follows a deep link, and waits.
- The **responder** is the wallet. It accepts: it scans the QR (a `liquid://` URI), authenticates the origin, and approves the session.

The same `WithConnections` extension serves both, with a platform engine per side: the web package ships the requester engine, the React Native package ships the responder engine, and the `@algorandfoundation/connections` meta package resolves the right one for your runtime.

## Sessions are durable, transports are ephemeral

The state lives in a `ConnectionsState` store holding `sessions` and `messages`:

```typescript
export interface ConnectionSession {
  id: string;
  origin: string;
  status: "pending" | "authenticating" | "connecting" | "connected" | "disconnected" | "failed";
  peer?: {
    domains: Record<string, unknown[]>; // accounts, identities, credentials, passkeys
    metadata?: { name?: string; icon?: string };
  };
  createdAt: number;
  updatedAt: number;
  error?: string;
}
```

A session is the durable pairing record: who you are connected to and what they shared. The transport underneath it (a WebRTC data channel, for example) is ephemeral. When the app restarts, persisted sessions are coerced to `disconnected`, and `resume(sessionId)` re-establishes a transport for the same session. Your UI can render the peer's accounts immediately from the persisted session while the transport reconnects in the background. That split is why a wallet connection survives phone reboots without re-pairing.

A live session walks the status ladder `pending`, then `authenticating`, then `connecting`, then `connected`. Failures land in `failed` with an `error`, and clean shutdowns in `disconnected`.

## Protocols are plug-ins

The core engine knows nothing about any particular wire. A **protocol** plug-in supplies establishment and transport; you pass the ones you want in the options:

```typescript
connections: {
  protocols: [liquidAuth({ url: "https://liquid.example.com" })];
}
```

The stock protocol is **Liquid Auth** (`@algorandfoundation/connections-liquid-auth`): FIDO2-style origin authentication with a signaling server, `liquid://` QR establishment, and a peer-to-peer WebRTC transport. Because protocols are plug-ins, another pairing scheme is a new package, not a fork of the engine.

## The handshake shares domain records

When a session connects, each side can expose a snapshot of its domains: account records, identity records, credential metadata, passkey metadata. They land in `session.peer.domains`, and from there each domain's remote mirror feeds them into the same stores local records live in, tagged with the session id. A remote account rides the exact same reactive state as a local one; the only difference is that its `sign` forwards over the session instead of into the local keystore. When the session is revoked, everything tagged with its id goes with it.

Only metadata crosses the wire. Key material, credential secrets, and signers stay home.

## Signing and messaging over a session

Two request families run over a connected session:

- **`signTransactions(sessionId, txns, indexes?)`** sends base64 msgpack transactions to the wallet and resolves with signed blobs (or `null` for entries the wallet declined or was not asked to sign). This is the path a `use-wallet` dapp ultimately exercises; see [dApps](/concepts/dapps/).
- **Secure messaging** gives the pair an encrypted channel: X25519 key agreement, XChaCha20-Poly1305 ciphertext, delivery tracked per message in the `messages` store (`pending`, `delivered`, `received`, `acknowledged`, `failed`).

## Where to go next

- [Connect a wallet and a dapp](/guides/connect-a-dapp/) for both sides in code.
- [dApps](/concepts/dapps/) for the dapp-framework layer above this one.
- [Provider](/concepts/provider/) for the wallet, RPC, and web deployment shapes.
