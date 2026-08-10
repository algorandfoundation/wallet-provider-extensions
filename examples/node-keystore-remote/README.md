# Node Remote Keystore Example

A keystore **daemon** and a **remote consumer**, in two processes, talking over
a WebSocket. The daemon's custodian is an [Open Wallet
Standard](https://openwallet.sh/) vault: it owns the seed and authenticates
every call, while the daemon only publishes the `KeyStoreAPI` it answers.

The point of the example is that the consumer cannot tell. It composes a
`Provider` with the remote keystore extension and from there it is normal
application code — the same code a wallet UI or a web page would run.

## What it demonstrates

- **Transport, not architecture** — the daemon serves
  `createKeyStoreWebSocketServer`; the consumer uses `createRemoteKeyStore` with
  `createWebSocketTransport`. Point the URL at another host and nothing else
  changes.
- **Custody stays put** — no key material ever leaves the vault. The consumer
  sees accounts as metadata (chain, address, derivation path) and signatures.
- **Per-operation credentials** — the OWS credential travels in each call's
  context, so the custodian authenticates the _request_, not the connection.
- **Denials survive the wire** — signing with the wrong credential comes back as
  `OWS INVALID_PASSPHRASE`, not as a quiet failure.
- **Live state** — the daemon pushes its key list on connect and on every
  change, so the consumer's reactive `provider.keys` works remotely.
- **The daemon as a policy point** — `before`/`error` hooks intercept every
  remote request before the vault sees it.
- **A named keystore** — the consumer mounts the daemon at `rpc.ows`, so it is
  reached as `provider.key.rpc.ows` (typed, not stringly). That is what lets a
  wallet keep a local keystore at `provider.key.store` and still talk to one or
  more remote services.

## Running it

From the repository root:

```bash
pnpm install
pnpm --filter node-keystore-remote-example start
```

That runs both processes for you and prints their interleaved output. To drive
them yourself, in two terminals:

```bash
pnpm --filter node-keystore-remote-example daemon    # prints the ws:// URL
pnpm --filter node-keystore-remote-example consumer  # connects to it
```

## Using a real OWS vault

By default the daemon binds an in-memory stand-in vault (`vault.ts`) so the
example runs on a machine that has never installed OWS. It implements the same
`OwsBinding` seam the real access layers do, holds real Ed25519 keys and refuses
a wrong credential — so the demo's behaviour is honest, only the custodian is
not.

With OWS installed, use the real thing:

```bash
OWS_REAL=1 OWS_PASSPHRASE="…owner passphrase or ows_key_… token…" \
  pnpm --filter node-keystore-remote-example daemon
```

## Serving something else

The daemon is not OWS-specific. Swap `createOwsKeyStore` for
`createNodeKeyStore` and it publishes the OS keychain instead; the consumer is
untouched. The `keystore` CLI does exactly that:

```bash
keystore serve --ws --port 7413    # the OS-keychain engine, over a WebSocket
```

## A word on exposure

The WebSocket is unauthenticated and bound to `127.0.0.1`. Anything that can
open it can ask the daemon to sign — which is safe here only because the vault
still demands a credential per call. Before exposing a daemon beyond loopback,
put TLS in front of it and keep a custodian that authenticates every request.
