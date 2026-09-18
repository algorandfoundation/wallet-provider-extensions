/**
 * Wallet-bound encryption flows, the keys domain's connections slice:
 * the keystore's ECDH put to work for the connections domain's secure
 * channel.
 *
 * Encryption is based on the CONNECTED REMOTE WALLET, not a self-owned
 * key: the connect handshake exchanged the wallet's `did:key` identity,
 * whose DID document carries a `keyAgreement` section (the X25519 twin
 * of its Ed25519 signing key). That key runs ECDH against the LOCAL
 * IDENTITY's key-agreement key and folds through HKDF into the shared
 * XChaCha20-Poly1305 key of the secure channel (`createSecureChannel`
 * in `@algorandfoundation/connections-core`), the same informal
 * contract the connections messaging layer seals its frames with.
 *
 * The local half is the identity's companion X25519 key minted into the
 * WebCrypto keystore (see `../../identities/keys/types.ts`):
 * NON-extractable, yet fully usable, because non-extractability blocks *export*,
 * not *use*, so the ECDH runs inside `SubtleCrypto` (`deriveBits`, via the keystore's
 * `deriveSharedSecret`) and only the 32-byte shared secret ever reaches
 * JS. (The Ed25519 signing key itself can't do this; WebCrypto limits
 * Ed25519 to `sign`/`verify`, hence the companion key.)
 *
 * No wallet, no options: {@link connectedWalletPeer} only yields a peer
 * for a LIVE (`connected`) session whose wallet identity exposes a usable
 * key-agreement key, and the panel renders nothing actionable until it
 * does. The identity itself comes from the IDENTITY store (the adapter
 * mirrors the wallet's identities there for the session's lifetime), so
 * the connections store only contributes the session, never identity
 * data (one source of truth per domain).
 */

import {
  createSecureChannel,
  keyAgreementPublicKey,
  type ConnectionMessage,
  type ConnectionSession,
} from "@algorandfoundation/connections";
import { isRemoteIdentity, type DappIdentity } from "../../identities/types.ts";
import type { DappProvider } from "../../provider/provider.ts";
import type { WalletEncryptionPeer, WalletEncryptionRoundTrip } from "./types.ts";

/**
 * Resolves the encryption peer from the two domain stores it spans: the
 * most recently updated `connected` session (connections store) paired
 * with the wallet identity the adapter mirrored for it into the identity
 * store (narrowed via the `metadata.source` discriminant and matched by
 * its `metadata.sessionId` tag) whose DID document yields a usable
 * X25519 key-agreement key. Identities without a DID document still
 * resolve through the `did:key` fallback (the X25519 key is recoverable
 * from the Ed25519 identifier alone).
 *
 * @param sessions - The sessions of the connections store.
 * @param identities - The identities of the identity store.
 * @returns The {@link WalletEncryptionPeer}, or `null` while no wallet
 * with a usable key-agreement key is connected.
 */
export function connectedWalletPeer(
  sessions: ConnectionSession[],
  identities: DappIdentity[],
): WalletEncryptionPeer | null {
  const connected = sessions
    .filter((s) => s.status === "connected")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const remote = identities.filter(isRemoteIdentity);
  for (const session of connected) {
    for (const identity of remote) {
      if (identity.metadata.sessionId !== session.id) continue;
      const didDocument = identity.didDocument ?? { id: identity.did ?? identity.address };
      const remotePublicKey = keyAgreementPublicKey(didDocument);
      if (remotePublicKey) return { session, identity, remotePublicKey };
    }
  }
  return null;
}

/**
 * Runs the secure-channel round-trip against the connected wallet from
 * the precomputed ECDH output: the 32-byte shared secret the keystore's
 * own `deriveSharedSecret` (`ctx.key.store`) hands back after
 * running X25519 inside WebCrypto with the local identity's
 * NON-extractable key. Seals `message` into a wire-ready frame and opens
 * it again. The wallet derives the SAME secret from its identity's
 * private half, which is exactly how the connections messaging layer encrypts
 * frames between the two parties.
 */
export function encryptDecryptWithWallet(
  sharedSecret: Uint8Array,
  message: string,
): WalletEncryptionRoundTrip {
  const channel = createSecureChannel({ sharedSecret });
  const sealed = channel.encrypt(message);
  return {
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
    decrypted: channel.decryptText(sealed),
  };
}

// Which local agreement key each session's messaging channel was enabled
// with, so a re-send (or a fresh peer) only re-derives when needed. The
// registered channel itself survives transport swaps inside the
// connections extension (re-attached on resume).
const enabledChannels = new Map<string, string>();

/**
 * Sends an ENCRYPTED message to the connected wallet: the end-to-end
 * half of the demo, driven straight off the provider context's own
 * methods (`ctx` is the connector-carried provider instance):
 *
 * 1. the keystore's `deriveSharedSecret` (`ctx.key.store`) runs
 *    the X25519 ECDH inside WebCrypto between the local identity's
 *    non-extractable agreement key and the wallet's `keyAgreement` key
 *    (first send per session only);
 * 2. the resulting channel is registered with the connections extension
 *    (`ctx.connection.enableSecureMessaging`), which also answers
 *    the wallet's own `message`/`message_ack` requests from then on;
 * 3. `ctx.connection.sendSecureMessage` seals the text and sends
 *    it over the session's rpc; the wallet decrypts it with the SAME
 *    secret (derived from its identity's private half), alerts the
 *    user, and the message progresses `pending` → `delivered` (receipt)
 *    → `acknowledged` (the user confirmed the wallet's alert).
 *
 * The message lands in the reactive connections store (`messages`), so
 * the panel renders the status live.
 */
export async function sendEncryptedMessage(
  ctx: DappProvider,
  peer: WalletEncryptionPeer,
  agreementKeyId: string,
  text: string,
): Promise<ConnectionMessage> {
  if (enabledChannels.get(peer.session.id) !== agreementKeyId) {
    const sharedSecret = await ctx.key.store.deriveSharedSecret!(
      agreementKeyId,
      peer.remotePublicKey,
      true,
    );
    ctx.connection.enableSecureMessaging(peer.session.id, {
      channel: createSecureChannel({ sharedSecret }),
    });
    enabledChannels.set(peer.session.id, agreementKeyId);
  }
  return ctx.connection.sendSecureMessage(peer.session.id, text);
}

/**
 * The messages of one session, oldest first: a selector over the
 * reactive `messages` slice of the connections store.
 */
export function sessionMessages(
  messages: ConnectionMessage[],
  sessionId: string,
): ConnectionMessage[] {
  return messages
    .filter((message) => message.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
