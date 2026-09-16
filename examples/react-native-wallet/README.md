# Wallet Provider (Test Harness)

This is a comprehensive React Native wallet example that serves as the **test harness for [Provider Extensions](../../)**.

It demonstrates how to compose multiple extensions into a single, unified `Provider` instance and how to handle reactive state and type narrowing in a real-world application.

## 🧱 Composed Extensions

The `ReactNativeProvider` in this application integrates several foundational extensions from this repository, along with local ones:

- **`WithLogStore`**: Unified logging for all operations.
- **`WithKeyStore`**: Secure storage and management of cryptographic keys (using `react-native-quick-crypto`).
- **`WithAccounts`**: Centralized state management for Algorand accounts.
- **`WithAccountsKeystore`**: A bridge that links accounts to keys in the keystore, enabling signing capabilities.
- **`WithIdentities`**: Decentralized identifiers (`did:key`) auto-populated from context-1 keystore keys (imported from the [`@algorandfoundation/identities`](../../identities/meta) meta package).
- **`WithCredentials`**: Verifiable Credentials held by the wallet (imported from the [`@algorandfoundation/credentials`](../../credentials/meta) meta package, which Metro resolves to [`@algorandfoundation/react-native-credentials`](../../credentials/react-native)) — the credential store engine persisted through a two-line MMKV driver, holder-bound to the identities extension, plus the W3C **Digital Credentials API** seams: the requester side at `provider.credential.digital` (still an explicit `unsupported` stub on React Native) and the wallet/holder registry at `provider.credential.digitalProvider`, backed on Android by the Digital Credentials expo module bundled inside that same package.
- **`WithPasskeys`**: The passkeys held by this device's credential provider (from [`@algorandfoundation/react-native-passkeys`](../../passkeys/react-native)) — the wallet UI shares the provider's native MMKV store (`react-native-passkey-autofill`): same records, same types, no key material in JS.
- **[`WithWatchedAccount`](./extensions/README.md)**: A local extension example for tracking accounts by public address (read-only).

## 🪪 Credential Wallet Demo

The **Credentials** screen stages the wallet/holder side of the [Digital Credentials API demo pair](../use-wallet-client):

- **Self-Issue** creates a structurally real SD-JWT VC (issuer JWT + selective disclosures, signed with the first identity's own `did:key` via the credential store's holder binding — see `lib/sample-credential.ts`) and stores it. No issuance backend is required.
- The credential detail screen renders the parsed claims and each **selective disclosure** the holder could reveal or withhold per presentation.
- The **Platform Status** section surfaces both seams: `provider.credential.digital.isSupported()` (the _requester_ side — still an explicit `unsupported` stub on React Native) and `provider.credential.digitalProvider.isSupported()` (the _wallet registry_, real on Android with Google Play services).
- With the registry supported, `lib/digital-credentials.ts` mirrors every stored SD-JWT VC into the OS credential registry and answers the OpenID4VP presentation requests the platform routes back — so any browser, including the [`use-wallet-client`](../use-wallet-client) verifier example, can request a credential from this wallet.

### Holder registry wiring (`lib/digital-credentials.ts`)

`setupDigitalCredentials(provider)` (installed from `app/_layout.tsx`) does two things, and no-ops with a console warning when `digitalProvider.isSupported()` is `false` (iOS, a device without Google Play services, or a build that does not contain the native module):

1. **Registry sync** — each stored SD-JWT VC becomes a registry entry whose `metadata.vct` and `metadata.claims` drive the platform matcher, so the OS chooser only offers credentials that can satisfy the incoming query. It re-runs on every credential store change; an empty store clears the registry.
2. **Presentation handling** — the routed OpenID4VP request is answered with a `vp_token` keyed by DCQL query id: only the requested claims are disclosed, and a key-binding JWT (signed through the credential's holder binding) ties the presentation to the verifier's `nonce` and attested `origin`.

> The registry lives in Play services, so entries survive restarts; the fulfillment path, however, needs this app's JS to attach its handler, and it aborts the platform flow with a clear message if that never happens.

## 🔀 Handling Multiple Account Types

A core pattern in this repository is using a single store to manage various types of accounts (e.g., keystore-backed, watched, multisig, etc.). We use **union types** and **type guards** to differentiate between them while maintaining a clean, unified API.

The accounts list labels each account by its kind:

- **HD Account** — a BIP32-Ed25519 key derived from the wallet seed (generated with the **HD** action on the Accounts screen).
- **Falcon Account** — a post-quantum Falcon-1024 key (the **Falcon** action; requires the native Falcon add-on). The bridge addresses it by its public key, exactly like ed25519 keys — concrete chain addressing lives in the `algorand-accounts-extension`.
- **Ed25519 Account** — a standalone (non-derived) ed25519 key, minted from the Keys screen.
- **Watched Account** — address-only, from the local `WithWatchedAccount` demo extension.

The kind comes from `metadata.keyType`, which the `accounts-keystore-extension` bridge records on every account it populates — and which the wallet also **transmits to connected dapps** (see `getAccounts` in `lib/connections.ts`: `ConnectionAccount` now carries the account's `type` + `metadata`).

### `switch(true)` Pattern

In `app/accounts.tsx`, we use a `switch(true)` statement with type guards for type-safe rendering of different account types. This is the recommended way to handle multiple types in the same store:

```tsx
import { isKeystoreAccount } from "@algorandfoundation/accounts-keystore-extension";
import { isWatchedAccount } from "@/extensions/example";

// ... inside the accounts map function
switch (true) {
  case isKeystoreAccount(item):
    // item is narrowed to KeystoreAccount (has .sign method, etc.)
    content = (
      <View>
        <MaterialCommunityIcons name="shield-key" size={24} />
        <Text>Keystore Account</Text>
      </View>
    );
    break;

  case isWatchedAccount(item):
    // item is narrowed to WatchedAccount (has .name, etc.)
    content = (
      <View>
        <MaterialCommunityIcons name="eye-outline" size={24} />
        <Text>Watched Account ({item.name})</Text>
      </View>
    );
    break;

  default:
    // Fallback for generic accounts
    content = <Text>{item.address}</Text>;
}
```

## 🚀 Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Start the app**
   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## 💡 Key Files

- `providers/ReactNativeProvider.tsx`: The core provider definition composing all extensions.
- `app/_layout.tsx`: Provider initialization and app bootstrapping.
- `extensions/example.ts`: Implementation of the local `WithWatchedAccount` extension.
- `app/accounts.tsx`: UI for managing accounts, demonstrating the `switch(true)` pattern.
- `lib/sample-credential.ts`: Self-issuance of the sample SD-JWT VC for the credential wallet demo.
- `lib/digital-credentials.ts`: The Digital Credentials holder wiring — OS registry sync plus the OpenID4VP presentation handler.
- `stores/credentials.ts`: The reactive credentials store plus the two-line MMKV persistence driver.
- `lib/connections.ts`: The Liquid Auth protocol wiring — native `SignalService` transport, keystore-backed signing/auth seams, STUN/TURN config, approval dialogs.
- `lib/liquidAuthFlow.ts`: The Liquid Auth WebAuthn ceremony (passkey assertion/attestation + `liquid` extension) run through the native cookie-jar client before peering — skipped entirely when the server's `/auth/session` already authenticates the wallet.
- `lib/connectionResume.ts`: The presence-driven auto-resume orchestrator — silently re-offers persisted sessions when the server reports the dapp waiting.
- `app/connections/index.tsx`: The connections screen — scan (camera) or paste/accept `liquid://` URIs, session list.
- `components/QrScannerModal.tsx`: The reusable camera QR scanner (`expo-camera`) behind the home screen's generic **Scan QR** action and the Connections screen's Scan button.
- `lib/scan.ts`: QR payload classification for the generic scanner — `FIDO:/` hybrid (cross-device passkey) codes vs `liquid://` connection requests.
- `lib/passkeyProvider.ts`: Shares the keystore master key + deterministic-P256 main key with the credential provider service — required before it can serve or register any passkey.
- `stores/connections.ts`: The reactive connections store plus its MMKV persistence driver.

## 🔗 Remote Connections (Liquid Auth)

The wallet mounts the responder-role `WithConnections` engine with the
`liquidAuth()` protocol — both imported from the
[`@algorandfoundation/connections`](../../connections/meta) meta package,
which Metro resolves to `@algorandfoundation/react-native-connections`
plus the react-native entry of `@algorandfoundation/connections-liquid-auth`:

- The dapp shows a `liquid://` QR code. Tap **Scan** on the Connections
  screen to read it with the camera (`expo-camera`; non-`liquid://` codes
  are rejected in-viewfinder), or paste / deep-link the `liquid://` URI,
  then accept — signaling and WebRTC run in the background `SignalService`
  (`react-native-liquid-auth`, vendored under
  `connections/liquid-auth/vendor` until it is published), wired through
  the `nativeSignalClientFactory` seam the protocol package ships.
- Accepting first runs the **Liquid Auth ceremony** (`lib/liquidAuthFlow.ts`):
  the service only relays signaling for authenticated sessions, so the wallet
  asserts an existing passkey — or registers a new one — via the system
  passkey dialog (`react-native-passkey`), attaching the `liquid` extension
  (wallet address + keystore ed25519 signature of the WebAuthn challenge).
  The HTTP exchange goes through the native module's cookie-jar `request()`,
  so the background signaling socket shares the authenticated session.
- WebRTC negotiates over Nodely's public STUN + TURN
  (`DEFAULT_ICE_SERVERS` in `lib/connections.ts`), so connections work
  across networks — the dapp example passes the same list.
- Once connected, `connect` / `sign_transactions` requests surface as native
  approval dialogs; signing routes through the keystore keys backing the
  accounts. The `connect` result transmits each account's `type` and stored
  metadata (e.g. `keyType`) so the dapp can label account kinds.
- **Reconnection is seamless after the first QR pairing**
  (`lib/connectionResume.ts`): the wallet keeps/starts its persistent
  signaling socket per known origin, the server rejoins the request room
  from the wallet's cookie session and broadcasts `presence`, and when
  presence shows the dapp waiting the wallet silently re-offers — the
  native offerer re-binds the authenticated origin session to the
  session's `requestId` via a fire-and-forget `link` first, and
  `lib/liquidAuthFlow.ts` skips the passkey ceremony while the server's
  `/auth/session` still authenticates the wallet. No new QR scan, no
  passkey assertion, no approval dialog while the server session lives.
- If the server session expired, the auto-resume stays quiet (it never
  pops a spontaneous passkey sheet); use the **Resume** action on a
  disconnected session in the Connections screen as the manual recovery
  path — that one may re-run the passkey ceremony.

Prerequisites: a reachable Liquid Auth service (the demo pair defaults to
`https://debug.liquidauth.com`), a wallet seed with at least one account
(the ceremony signs as the first keystore-backed account), and this wallet
set up as the device's credential provider (see the Passkeys section) so
the passkey ceremony against the service's `rpId` resolves against the
wallet's own store.

## 🔑 Passkeys (Credential Provider)

This app registers `react-native-passkey-autofill` as an Android **credential
provider** (see the config plugin entry in `app.json` — `site` points at the
Liquid Auth service). That is what routes a dapp's
`navigator.credentials.get` to this wallet.

- The **Passkeys** screen lists the provider's stored passkeys (shared native
  MMKV store, public metadata only), lets you delete them, and shows whether
  this wallet is the device's _active_ provider — with a shortcut into the
  Android credential-manager settings when it isn't.
- **Reconcile** fetches the WebAuthn assertion options the Liquid Auth service
  would send for a passkey (`fetchAssertionOptions` from
  `@algorandfoundation/connections`) and marks local entries as
  `server-known` / strays, so future requests can be built from the local
  store without a server round-trip.

> Note: Android only allows enabling a credential provider from Settings —
> use the Enable shortcut on the Passkeys screen, then pick this wallet under
> _Passwords, passkeys & autofill_.

### Sharing the wallet keys with the provider

Enabling the provider is **not** enough: the native service refuses to
surface any passkey entries (for `get` _and_ `create` requests alike) until
the wallet has shared two things with it (`lib/passkeyProvider.ts`):

1. the keystore **master key** (`setMasterKey`) — so the provider service can
   unseal records in the shared `keystore` MMKV instance, and
2. the **passkey main key** id (`setMainKeyId`) — the deterministic-P256
   `hd-root-key` (`metadata.scheme: "pbkdf2-p256"`) domain passkeys are
   derived from, itself derived from the wallet seed so a phrase restore
   reproduces every passkey.

Without this hand-off, Android's Credential Manager reports **"No passkeys
available"** for every request routed to this provider — including the
browser's FIDO hybrid (QR) flow and the `liquid` extension — even when the
wallet is the enabled provider.

The sync runs automatically after **Create Wallet Seed** (Keystore screen)
and can be (re-)triggered from the Passkeys screen's **Wallet keys** row,
which also shows whether the provider is currently pointed at this wallet's
main key. It prompts for biometrics (the master-key read is gated).

### Cross-device sign-in (FIDO hybrid QR)

The home screen's **Scan QR** action also reads the `FIDO:/` QR a browser
shows under _"Use a passkey on another device"_. The scanned URI is handed to
the OS as a `VIEW` intent, which Google Play services resolves
(`com.google.android.gms/.fido.authenticator.ui.QRBounceActivity`): it runs
the caBLE tunnel + BLE proximity check and serves the assertion through
Android Credential Manager — i.e. through **this wallet's credential
provider** when it is enabled (make it the _preferred_ provider so another
manager, e.g. 1Password, doesn't take over the entry list).

When the browser offers **"Remember this device"** during the QR handshake,
Play services sends it linking info; from then on the phone appears by name
in that browser's passkey dialog and can be invoked without scanning again
(Play services wakes the phone over the cloud tunnel and routes the request
to the same credential provider).
