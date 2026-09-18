/**
 * Liquid Auth protocol wiring for the wallet (responder) side.
 *
 * Builds the `liquidAuth({...})` plug-in for the React Native
 * connections engine. The flow is QR-only: the wallet scans (or
 * pastes) a dapp's `liquid://` URI, the engine `accept()`s it, and the
 * connection comes up.
 *
 * - **Transport**: the native `SignalService` of
 *   `react-native-liquid-auth` (via `nativeSignalClientFactory`, the
 *   prewired seam the react-native entry of
 *   `@algorandfoundation/connections` re-exports), so the WebRTC peer
 *   and the signaling socket live in the background service and survive
 *   the app being backgrounded. No JS WebRTC polyfill is required.
 *   Negotiation runs over Nodely's public STUN + TURN
 *   ({@link DEFAULT_ICE_SERVERS}).
 * - **Authentication**: before peering, the Liquid Auth WebAuthn
 *   ceremony (`./liquidAuthFlow`) asserts/registers a passkey via the
 *   system dialog and completes the `liquid` extension with a keystore
 *   ed25519 signature; the HTTP exchange rides the native cookie-jar
 *   client so the signaling socket is authenticated.
 * - **Wallet seams**: the connection DOMAINS (accounts, identities,
 *   passkeys, credentials) are NOT declared here: the connections
 *   engine infers them from the store extensions the provider mounts
 *   and answers the `connect` inventory exchange from their
 *   session-scoped `remote` mirrors (the accounts mirror gets an
 *   `expose` projection normalizing the keystore bridge's base64
 *   addresses; see {@link exposeConnectionAccounts} and the provider
 *   construction in `app/_layout.tsx`). What stays here is signing
 *   (routed through the keystore, `provider.key.store.sign`, with the
 *   keys backing the keystore accounts) and the approvals, surfaced
 *   as native dialogs.
 */
import { Alert } from "react-native";
import algosdk from "algosdk";
import type { IceServer } from "react-native-liquid-auth";
import {
  createSecureChannel,
  keyAgreementPublicKey,
  liquidAuth,
  nativeSignalClientFactory,
  toAlgorandAddress,
  type ConnectionProtocol,
  type LiquidMessagingPeer,
  type SecureChannel,
} from "@algorandfoundation/connections";
import type { IdentityRecord } from "@algorandfoundation/identities";
import { runLiquidAuthCeremony } from "./liquidAuthFlow";

import { accountsOf, accountsStore } from "@/stores/accounts";
import { connectionsStore } from "@/stores/connections";
import { identitiesStore } from "@/stores/identities";
import type { AppAccount, ReactNativeProvider } from "@/providers/ReactNativeProvider";

// The provider is constructed in `app/_layout.tsx` WITH this protocol
// registered, so the wallet seams late-bind to it (they only run once a
// dapp is connected, long after construction).
let providerRef: ReactNativeProvider | null = null;

/** Late-binds the provider the wallet seams sign through. */
export function setConnectionsProvider(provider: ReactNativeProvider): void {
  providerRef = provider;
}

function requireProvider(): ReactNativeProvider {
  if (!providerRef) throw new Error("connections provider not initialized");
  return providerRef;
}

/**
 * Session ids this wallet has PAIRED at least once, i.e. that were ever
 * `connected` (or hydrated from persistence as `disconnected`, which
 * implies a completed pairing in an earlier run). Tracked continuously
 * because the engine flips a session to `authenticating` BEFORE the
 * `authenticate` seam runs, so the live status at that point cannot tell
 * a fresh accept from a resume; pairing history can.
 */
const pairedSessionIds = new Set<string>();

function recordPairedSessions(): void {
  for (const session of connectionsStore.state.sessions) {
    if (session.status === "connected" || session.status === "disconnected") {
      pairedSessionIds.add(session.id);
    }
  }
}
recordPairedSessions();
connectionsStore.subscribe(recordPairedSessions);

/**
 * The ICE servers both demo sides negotiate through: Nodely's public
 * STUN + TURN (the credentials liquid-auth publishes for its demos).
 * Without a TURN relay, cross-network negotiation (phone ↔ dapp over
 * the public signaling server) regularly stalls at ICE.
 */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  {
    urls: ["stun:geo.turn.algonode.xyz:80", "stun:global.turn.nodely.io:443"],
  },
  {
    urls: [
      "turn:geo.turn.algonode.xyz:80?transport=tcp",
      "turns:global.turn.nodely.io:443?transport=tcp",
    ],
    username: "liquid-auth",
    credential: "sqmcP4MiTKMT4TGEDSk9jgHY",
  },
];

/** Native yes/no dialog as a promise (the approval seams are async). */
function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Reject", style: "cancel", onPress: () => resolve(false) },
        { text: "Approve", onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

/**
 * Canonical Algorand address of a stored account when derivable (the
 * keystore bridge keys accounts by the base64 public key), falling back
 * to the stored value (e.g. the hardcoded watched account).
 */
function connectionAddress(address: string): string {
  try {
    return toAlgorandAddress(address);
  } catch {
    return address;
  }
}

/**
 * The `expose` projection of the accounts domain's remote mirror (see
 * `accounts.remote.expose` in `app/_layout.tsx`): the keystore bridge
 * keys accounts by base64 public key, so the addresses are normalized
 * to canonical Algorand addresses before they travel the wire. The
 * account's `type` and stored metadata (`keyType`, …) travel through
 * verbatim, so the dapp can tell a watched account from an HD account
 * from a post-quantum Falcon account.
 */
export function exposeConnectionAccounts(accounts: AppAccount[]): AppAccount[] {
  return accounts.map((account) => ({
    ...account,
    address: connectionAddress(account.address),
  }));
}

/**
 * Derives a session's secure-messaging channel: the wallet half of the
 * encrypted messaging the dapp initiates (INFORMAL until the messaging
 * spec lands):
 *
 * 1. The dapp introduced its identities in the `connect` handshake's
 *    `domains.identities`; the first DID document with a usable
 *    `keyAgreement` key yields the REMOTE X25519 public key.
 * 2. The wallet's own half is its LOCAL identity key (a context-1 XHD
 *    child): its DID document advertises the did:key X25519 twin of the
 *    Ed25519 public key, so the keystore's `"x25519"` agreement mode
 *    re-derives the child scalar and runs the raw montgomery ECDH the
 *    dapp mirrors against that twin.
 *
 * Both sides then fold the SAME 32-byte secret through the secure
 * channel (HKDF → XChaCha20-Poly1305). Returns `null` when either half
 * is missing; messaging simply stays off for the session.
 */
async function walletMessagingChannel(peer: LiquidMessagingPeer): Promise<SecureChannel | null> {
  // The dapp's key-agreement key, from the identity records it announced.
  const identities = (peer.domains.identities ?? []) as IdentityRecord[];
  let remotePublicKey: Uint8Array | null = null;
  for (const identity of identities) {
    const didDocument = identity.didDocument ?? { id: identity.did ?? identity.address };
    remotePublicKey = keyAgreementPublicKey(didDocument) ?? null;
    if (remotePublicKey) break;
  }
  if (!remotePublicKey) return null;

  // The wallet's identity key is the same one the identity store's
  // remote mirror exposes, so the dapp's channel binds to the matching
  // public half.
  const identity = identitiesStore.state.identities.find(
    (candidate) => (candidate.metadata as { keyId?: string } | undefined)?.keyId,
  );
  const keyId = (identity?.metadata as { keyId?: string } | undefined)?.keyId;
  if (!keyId) return null;

  const keystore = requireProvider().key.store;
  if (!keystore.deriveSharedSecret) return null;
  // Raw X25519 inside the keystore: the identity's private scalar never
  // surfaces; only the 32-byte shared secret does.
  const sharedSecret = await keystore.deriveSharedSecret(keyId, remotePublicKey, true, "x25519");
  return createSecureChannel({ sharedSecret });
}

/**
 * Signs the requested positions of the group through the keystore:
 * decode the unsigned txn, look up the keystore key backing the sender
 * account, ed25519-sign the canonical `bytesToSign()`, and re-encode as
 * signed-transaction msgpack. Positions the wallet cannot sign resolve
 * to `null`, matching the `sign_transactions` wire contract.
 */
async function signTransactions(
  txns: Uint8Array[],
  indexesToSign?: number[],
): Promise<(Uint8Array | null)[]> {
  const provider = requireProvider();
  const indexes = indexesToSign ?? txns.map((_, i) => i);
  return Promise.all(
    txns.map(async (bytes, i) => {
      if (!indexes.includes(i)) return null;
      const txn = algosdk.decodeUnsignedTransaction(bytes);
      const sender = txn.sender.toString();
      // Senders arrive as canonical addresses; stored accounts may be
      // keyed by the base64 public key, so compare normalized.
      const account = accountsOf(accountsStore.state).find(
        (a) => connectionAddress(a.address) === sender,
      );
      const keyId = (account?.metadata as { keyId?: string } | undefined)?.keyId;
      if (!keyId) return null;
      const signature = await provider.key.store.sign(keyId, txn.bytesToSign());
      return txn.attachSignature(sender, signature);
    }),
  );
}

/** Base64url without padding (the liquid extension signature encoding). */
function toBase64Url(bytes: Uint8Array): string {
  return algosdk.bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The account (and its backing keystore key) the wallet authenticates
 * Liquid Auth connections as: the first account with an **ed25519**
 * keystore key, so the liquid extension's address and ed25519 signature
 * always match (post-quantum Falcon accounts are skipped: the liquid
 * extension's challenge signature is ed25519 by contract). The stored
 * (base64 public key) address is normalized to the canonical Algorand
 * address the liquid-auth service expects.
 */
export function liquidAuthAccount(): { address: string; keyId: string } {
  const account = accountsOf(accountsStore.state).find((a) => {
    const meta = a.metadata as { keyId?: string; keyType?: string } | undefined;
    return meta?.keyId && meta.keyType !== "falcon-1024";
  });
  const keyId = (account?.metadata as { keyId?: string } | undefined)?.keyId;
  if (!account || !keyId) {
    throw new Error("no keystore-backed account available for the liquid challenge");
  }
  return { address: toAlgorandAddress(account.address), keyId };
}

/**
 * The Liquid Auth protocol plug-in for the wallet. Register it in the
 * provider's `connections.protocols` option.
 */
export function createLiquidAuthProtocol(): ConnectionProtocol {
  return liquidAuth({
    // Drive signaling + WebRTC through the native background service,
    // negotiating over STUN + TURN so cross-network connections succeed
    // (the react-native entry of connections-liquid-auth prewires the
    // seam to the vendored react-native-liquid-auth module).
    createSignalClient: nativeSignalClientFactory(),
    rtcConfiguration: { iceServers: DEFAULT_ICE_SERVERS },
    // A real liquid-auth service only relays signaling for authenticated
    // sessions: run the WebAuthn attestation/assertion ceremony (system
    // passkey dialog + the keystore-signed liquid extension) through the
    // native cookie-jar `request()` so the background socket shares the
    // authenticated session, THEN let the responder peer.
    authenticate: async (client, uri) => {
      const { address, keyId } = liquidAuthAccount();
      await runLiquidAuthCeremony(
        uri.origin,
        uri.requestId,
        {
          address,
          signChallenge: (challenge) => requireProvider().key.store.sign(keyId, challenge),
          device: "React Native Wallet",
        },
        // A previously paired session may reuse the server's authenticated
        // cookie session without a fresh passkey assertion: the native
        // offerer re-binds the session's requestId via its fire-and-forget
        // `link` before the offer goes out.
        { previouslyPaired: pairedSessionIds.has(uri.requestId) },
      );
      client.authenticated = true;
    },
    // The ed25519 seam for hosts that run the package's JS attestation
    // instead of the native ceremony above.
    authSigner: async (challenge) => {
      const { address, keyId } = liquidAuthAccount();
      const signature = await requireProvider().key.store.sign(keyId, challenge);
      return { address, signature: toBase64Url(signature) };
    },
    wallet: {
      signTransactions,
      metadata: { name: "React Native Wallet" },
      approveConnect: (params, context) => {
        // A resume renegotiates an ALREADY approved pairing: its `connect`
        // handshake auto-approves. The responder tags each transport's
        // handshake with an approval context, so this holds even though
        // the dapp's `connect` request lands only after `resume()` has
        // resolved. Re-prompting would be noise (and every background
        // presence-driven resume would wedge behind an alert nobody
        // asked for). Only brand-new pairings prompt.
        if (context?.resumed) return true;
        return confirm(
          "Connection request",
          `${params.metadata?.name ?? "A dapp"} wants to connect and see your accounts, identities, and passkey/credential metadata.`,
        );
      },
      approveSignTransactions: (params) =>
        confirm(
          "Signature request",
          `Sign ${params.indexesToSign?.length ?? params.txns.length} of ${params.txns.length} transaction(s)?`,
        ),
    },
    messaging: {
      channel: walletMessagingChannel,
      // The ack is the USER's receipt, not the transport's: the dapp
      // already got a delivery receipt from the rpc response, so the
      // explicit `message_ack` only goes back once the user confirms
      // the alert below.
      autoAcknowledge: false,
      onMessage: (message, actions) => {
        // Alert the user: the decrypted secure message, acknowledged
        // back to the dapp on confirmation (upgrading the dapp's copy
        // from `delivered` to `acknowledged`).
        Alert.alert("Encrypted message", message.text, [
          {
            text: "Acknowledge",
            onPress: () => {
              void actions.acknowledge().catch(() => {
                // The transport may have dropped since; the message
                // stays `delivered` and can be acked on reconnect.
              });
            },
          },
        ]);
      },
    },
  });
}
