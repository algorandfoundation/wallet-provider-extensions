# use-wallet Client Example

A Vite + React **verifier dapp** that composes the two seams a client application needs:

- **Wallet connection** via [`@txnlab/use-wallet-react`](https://github.com/TxnLab/use-wallet): connect Pera / Lute (or the dev-only mnemonic wallet) for on-chain interactions. As use-wallet's account primitives formalize, this panel is the piece that keeps aligning with them.
- **Credential presentation** via the **W3C Digital Credentials API**, where `webDigitalCredentials` from the [`@algorandfoundation/credentials`](../../credentials/meta) meta package (its `browser` condition resolves to [`credentials-web`](../../credentials/web)) forwards an unsigned OpenID4VP request (`openid4vp-v1-unsigned`, DCQL query) to `navigator.credentials.get({ digital: { requests } })` and lets the browser/OS route it to a registered wallet.

On top of those it stages the **local vs remote** contrast the wallet-provider extensions are built around:

- **Remote**: keys, passkeys, credentials, and identities the **connected wallet** syncs over the Liquid Auth connection pipe. The connect handshake carries them as domain records keyed by domain id on `session.peer.domains`, and the connections engine feeds each record set into its **domain store's** session-scoped `remote` mirror (identity, passkeys, and credential stores) for the session's lifetime. This creates one source of truth per domain, so no panel ever reads inventory out of the connections store.
- **Local**: keys minted in **this browser** by the IndexedDB-backed web keystore (the [`@algorandfoundation/keystore`](../../keystore/meta) meta package, resolving to [`keystore-web`](../../keystore/web)): a fresh Ed25519 **identity key** projected as a `did:key` identity, plus its X25519 **key-agreement companion** advertised in the DID document's `keyAgreement` section (WebCrypto limits Ed25519 keys to `sign`/`verify`, so the identity's ECDH half is a separate non-extractable key).

**Encryption is based on the connected remote wallet**, as there is no self-owned encryption key. The `WalletEncryptionPanel` shows no options until a wallet connects; once it does, the wallet's identity DID document provides the `keyAgreement` key (the X25519 twin of its Ed25519 signing key), the X25519 ECDH runs **inside WebCrypto** on the local identity's non-extractable companion key (non-extractability blocks _export_, not _use_. The keystore's `deriveSharedSecret` calls `subtle.deriveBits` and only the 32-byte shared secret surfaces), and `createSecureChannel` from [`@algorandfoundation/connections`](../../connections/meta) (re-exporting [`connections-core`](../../connections/core)) folds it into the shared XChaCha20-Poly1305 key (HKDF-SHA256), which is the same channel the connections secure-messaging layer seals its frames with.

And the demo runs **end to end**: the dapp introduces its local identities with the connect handshake (the connections engine exposes the identity store's records through the handshake's `identities` domain), so the wallet derives the SAME shared key from its identity's private half. **Send to wallet** seals the message, the wallet decrypts it and **alerts its user**, and the message's status progresses live in the panel: `pending` → `delivered` (the wallet's receipt) → `acknowledged` (the user confirmed the alert). Messages persist in the connections store on both sides.

Both kinds of identity live in the **one** identity store as a narrowable union (`metadata.source: "local" | "connection"`), mirroring the accounts store pattern. The wallet's passkey and credential inventory follows the same rule: the connections engine feeds the handshake's passkey descriptors into the `WithPasskeys` store's `remote` mirror and the credential metadata into the `WithCredentials` store's mirror. Under this model, each domain owns its state, while the connections store only manages sessions and messages.

The UI shares the design system of the [`web-keystore`](../web-keystore) example, using the same tokens and components (cards, chips with source dots, the header status pill, the console output), ensuring the two demos read as siblings. The page is organized by **domain**: Accounts, Identities, Credentials, Passkeys, Keys, Connections. Each domain section names the packages in use as chips, mirroring the [`react-native-wallet`](../react-native-wallet) example's home screen.

The **Provider determines the render**: only the Accounts section (the use-wallet connection surface) is always visible. The extension-backed domains appear only while the Wallet Provider is the **active** use-wallet wallet, and only for the extensions its Provider instance actually **adopted**; these are inferred at runtime from the namespaced APIs the extensions install (`WithConnections` → `connection`, `WithKeyStore` → `key`, …; see [`src/lib/ui/extensions.ts`](./src/lib/ui/extensions.ts)), not hard-coded. This inference is informal by design, as a provider discovery spec will formalize capability negotiation later.

## The demo pair

This client is the **requester half** of the credential wallet demo staged in this repository:

```
use-wallet-client (this app)            react-native-wallet (holder)
┌──────────────────────────┐            ┌────────────────────────────┐
│ use-wallet connection    │            │ WithCredentials store      │
│ webDigitalCredentials.get├── DC API ──► self-issued SD-JWT VC      │
│ (OpenID4VP + DCQL)       │  (browser/ │ Android registry: live     │
└──────────────────────────┘    OS)     └────────────────────────────┘
```

- The [`react-native-wallet`](../react-native-wallet) example **self-issues** the demo attestation (`https://example.com/credentials/demo-attestation`, an SD-JWT VC with selectively-disclosable `given_name` / `family_name` / `membership_level` claims).
- This client requests exactly that credential by `vct` through the DC API.
- The request path is fully verifiable in a DC-API-enabled browser (Chrome/Edge 141+): the platform chooser opens and, with no registered wallet, reports that no credential matched. On other browsers the typed `DigitalCredentialsUnsupportedError` is rendered.
- With a wallet registered (specifically, the react-native-wallet example built with the Digital Credentials Android module bundled inside `@algorandfoundation/react-native-credentials`), the OS routes this request to it and the wallet answers with a key-bound selective disclosure: same-device on Android, or cross-device from desktop Chrome/Edge via the hybrid handshake.

> ⚠️ The holder half needs a **native Android build** of the wallet example (`pnpm --filter react-native-wallet android`) on a device with Google Play services. A JS-only reload never registers anything; the wallet's Credentials screen shows the registry as `Unavailable` and logs a warning when that is the case.

## Running the example

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Start the dev server (`localhost` is a secure context, so the DC API works without TLS setup):

   ```bash
   pnpm --filter use-wallet-client-example dev
   ```

3. Type-check / build:

   ```bash
   pnpm --filter use-wallet-client-example typecheck
   pnpm --filter use-wallet-client-example build
   ```

## Key files

- [`src/App.tsx`](./src/App.tsx): the `WalletManager` composition (Wallet Provider, Pera, Lute, mnemonic) and the domain-organized, provider-determined page layout; the manager adopts the Provider's shared TanStack store via `options: { store }`.
- [`src/lib/ui/extensions.ts`](./src/lib/ui/extensions.ts): extension adoption inference: it probes the Provider instance for the namespaced API each known extension installs, so the page renders only the domains backed by extensions the provider actually adopted.
- [`src/components/DomainSection.tsx`](./src/components/DomainSection.tsx): the domain block, consisting of a colored letter icon, title, description, package-count badge, and chips naming the packages the domain runs on, mirroring the `react-native-wallet` example's home screen.
- [`src/lib/provider/adapter.ts`](./src/lib/provider/adapter.ts): the **example dapp connector**, which is the `ProviderAdapter`, a use-wallet v5 `BaseWallet` over the dapp's `@algorandfoundation/wallet-provider` Provider (connections, accounts, and identities stores). The adapter **owns the provider**: there is no global instance, as it **constructs** the provider from its adapter options (`createProvider`) and **carries** it as `adapter.provider`, the context (`ctx`) every provider-driving flow takes as its first parameter (the app resolves it via `walletManager.getWallet(WALLET_ID)`). The wallet entry is the `dappWallet()` factory, shaped like every other use-wallet factory (`pera()`, `lute()`, …): call it with no arguments, or pass the few provider-level construction options it exposes (the connection protocol connects route through, the signaling/ICE knobs, a metadata override). Accounts are typed as `ProviderWalletAccount` (see [`src/lib/accounts/types.ts`](./src/lib/accounts/types.ts)): the `type` and `metadata` the wallet transmitted over the connect handshake travel through verbatim.
- [`src/components/WalletPanel.tsx`](./src/components/WalletPanel.tsx): use-wallet connect/disconnect panel: lists **all** accounts of every connected wallet (the active one highlighted, any other one a click away), badges each account with its friendly kind name (see `accountKinds.ts`), and collapses the wallet picker into a compact summary once a connection is established ("Change wallets" re-expands it).
- [`src/lib/ui/accountKinds.ts`](./src/lib/ui/accountKinds.ts): friendly account-kind names from the transmitted `type`/`metadata.keyType`: **HD Account**, **Ed25519 Account**, post-quantum **Falcon Account**, **Watched Account** (mirroring the `react-native-wallet` example's labels); accounts of wallets without type information get no badge.
- [`src/components/IdentityPanel.tsx`](./src/components/IdentityPanel.tsx): ALL identities from the Provider's single identity store, split back into **local** (minted from the browser keystore) and **remote** (synced from the connected wallet over the connect handshake) via their `metadata.source` discriminant.
- [`src/lib/identities/localIdentities.ts`](./src/lib/identities/localIdentities.ts) / [`src/lib/identities/keys/types.ts`](./src/lib/identities/keys/types.ts) / [`src/components/LocalKeystorePanel.tsx`](./src/components/LocalKeystorePanel.tsx): the local browser-keystore flow: generate an Ed25519 identity key plus its non-extractable X25519 key-agreement companion, projected as a `did:key` `LocalIdentity` with a W3C DID document that advertises the companion in `keyAgreement`.
- [`src/lib/keys/connections/encryption.ts`](./src/lib/keys/connections/encryption.ts) / [`src/components/WalletEncryptionPanel.tsx`](./src/components/WalletEncryptionPanel.tsx): encryption with the **connected remote wallet**, which is hidden until a session is `connected`; derives the shared secure-channel key from the wallet identity's `keyAgreement` key and the local identity's non-extractable keystore key (X25519 ECDH inside WebCrypto via `deriveSharedSecret`), runs the seal/open round-trip on the exact wire frame of the connections messaging layer, and sends real encrypted messages end to end (`sendEncryptedMessage` → `enableSecureMessaging`/`sendSecureMessage`): the wallet decrypts, alerts its user, and the panel's message log tracks `pending` → `delivered` → `acknowledged`.
- [`src/components/WalletPasskeysPanel.tsx`](./src/components/WalletPasskeysPanel.tsx) / [`src/components/WalletCredentialsPanel.tsx`](./src/components/WalletCredentialsPanel.tsx): the passkey and credential metadata the wallet exposed over the same handshake, read from the **passkeys and credential stores**, which are the domains' single sources of truth. The connections engine feeds the handshake's `passkeys` and `credentials` domain records into those stores' session-scoped `remote` mirrors on connect and revokes them on disconnect; the adapter only replays a persisted session's peer records into the mirrors on resume (raw payloads never travel the pipe, so `raw` stays empty).
- [`src/lib/provider/provider.ts`](./src/lib/provider/provider.ts): the dapp Provider's `createProvider(options)` factory, composed with the `Provider.withExtensions` static factory (the instance type is **inferred** from the extension list, with no subclass or field declarations; exported as the `DappProvider` ctx type), including `WithConnections` and the `liquidAuth()` protocol from the `@algorandfoundation/connections` meta package (its `browser` condition resolves to `connections-web` plus the bundled `connections-liquid-auth` default protocol) registered (signaling URL and ICE servers configurable through the construction options), plus `WithAccounts` (`@algorandfoundation/accounts`, backed by the ONE store shared with the `WalletManager`), `WithIdentities` (`@algorandfoundation/identities`, generic over the `DappIdentity = LocalIdentity | RemoteIdentity` union from [`src/lib/identities/types.ts`](./src/lib/identities/types.ts)), `WithCredentials` (`@algorandfoundation/credentials`, with an explicit memory driver; the mirrored inventory is session-scoped, and persisting it would create a second source of truth next to the persisted session record), `WithPasskeys` (`@algorandfoundation/passkeys-core`, fed through its session-scoped `remote` mirror), and `WithKeyStore` (`@algorandfoundation/keystore`, the local browser keystore). The reactive store instances behind those extensions live in [`src/stores`](./src/stores).
- [`src/components/ConnectModal.tsx`](./src/components/ConnectModal.tsx): the `liquid://` QR pop-up, a page-level modal (like the QR modal in Pera's connect library) that **observes the connections store directly**. A connect parks the out-of-band request as a peerless `pending`/`connecting` session (its id is the request id; selector in [`src/lib/ui/pendingRequest.ts`](./src/lib/ui/pendingRequest.ts)), opening whenever one exists and rendering the request as a QR code for cross-device scanning with a copyable URI; it closes itself when the attempt settles, and dismissing it (×, backdrop, Escape) just hides the QR while the connect keeps waiting.
- [`src/components/ConnectionPanel.tsx`](./src/components/ConnectionPanel.tsx): the established wallet session (including peer name, session id, and account count), plus its reactive status (connected / reconnecting… / disconnected).
- [`src/lib/connections/autoResume.ts`](./src/lib/connections/autoResume.ts): seamless session resume, which re-parks the session on the signaling rendezvous whenever a live transport drops (with capped exponential backoff on signaling failures); the initial page-load resume is kicked by the adapter, and intentional disconnects are suspended by the adapter's disconnect path.
- [`src/components/PresentationPanel.tsx`](./src/components/PresentationPanel.tsx): builds the OpenID4VP request entry and calls `webDigitalCredentials.get(...)`, rendering the response or the typed error.
- [`src/lib/ui/format.ts`](./src/lib/ui/format.ts): the shared display helpers (`truncate`, `bytesToHex`), providing pure formatting kept out of the rendering layer, mirroring the web-keystore example's convention.

## Connecting to the demo wallet (Liquid Auth)

The **Wallet Provider** entry in the wallet list is the local
[`ProviderAdapter`](./src/lib/provider/adapter.ts) over the dapp Provider's
connections engine. Clicking **Connect**:

1. creates the out-of-band connection request and pops it up as a
   `liquid://` QR code in the `ConnectModal`;
2. scan the QR with the [`react-native-wallet`](../react-native-wallet)
   example (or paste the URI); the wallet joins the signaling room on
   the Liquid Auth service (`https://debug.liquidauth.com` by default;
   override with `VITE_LIQUID_AUTH_URL`) and the pending connect
   resolves with the established session.

Once connected, use-wallet signing routes through the connection RPC to
the wallet's approval dialogs.

### Sessions survive reloads

Sessions persist in `localStorage`, and the connection now resumes
**seamlessly**, requiring no QR and no passkey ceremony:

- **On page load** the dapp adopts the persisted session optimistically:
  the accounts render immediately (like a WalletConnect pairing) while
  `ctx.connection.resume(sessionId)` re-parks the session on the
  Liquid Auth signaling rendezvous in the background. If the wallet is
  **online**, the server resolves the rendezvous right away, the wallet
  re-offers, the connect handshake re-runs on the fresh transport, and
  the session flips back to `connected` silently; signing just works.
  If the wallet is **offline**, the parked resume simply waits: the
  `ConnectionPanel` shows **reconnecting…** and the connection
  re-establishes the moment the wallet comes online, with no modal. (A sign request
  issued before that fails with the engine's "no live connection"
  error.)
- **On a dropped transport** (either side loses the WebRTC channel), the
  engine marks the session `disconnected` in the reactive store and the
  dapp re-parks automatically (see [`src/lib/connections/autoResume.ts`](./src/lib/connections/autoResume.ts));
  restoring either side auto-reconnects. Signaling failures are retried
  with capped exponential backoff.
- **Intentional disconnects** are exempt: the adapter's disconnect path
  suspends auto-resume for that session before closing it.

> Wallet-side prerequisite: the wallet app **auto-re-offers on
> presence**: when it sees the dapp parked on the session's signaling
> rendezvous, it re-initiates the WebRTC offer. The
> [`react-native-wallet`](../react-native-wallet) example does this out
> of the box.

The same connect handshake also carries the wallet's **identities**
(`did:key` + DID document, no signers): the connections engine feeds
the handshake's `identities` records (`session.peer.domains.identities`)
into the identity store's session-scoped remote mirror (tagged
`metadata.source: "connection"`), the `IdentityPanel` renders them in
its **Remote** section, and a disconnect revokes them again. This means session
lifetime = identity lifetime. Identities minted from the local browser
keystore live in the same store tagged `source: "local"` and are
unaffected by connection lifecycles.

It also carries the wallet's **passkey and credential metadata**
(the `passkeys` / `credentials` records on `session.peer.domains`):
public passkey descriptors (no key material) and credential
presentation metadata (no raw payloads or claims). This inventory
follows the exact same rule as the identities: the connections engine
feeds it into the domain stores' session-scoped `remote` mirrors on
connect and revokes it on disconnect, while the adapter replays a
persisted session's peer records into the same mirrors on resume:
**session lifetime = inventory lifetime**, and the
`WalletPasskeysPanel` / `WalletCredentialsPanel` read only their domain
stores. Because sessions persist in `localStorage`, a page reload adopts
the persisted session and re-mirrors the inventory immediately; it is still
presentable without a fresh scan.
