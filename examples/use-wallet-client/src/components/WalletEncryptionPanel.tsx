import { useState } from "react";
import { useStore } from "@tanstack/react-store";
import { connectionsStore } from "../stores/connectionsStore.ts";
import { identityStore } from "../stores/identityStore.ts";
import { keyStore } from "../stores/keyStore.ts";
import type { DappProvider } from "../lib/provider/provider.ts";
import { isKeyAgreementKey, rawX25519PublicKey } from "../lib/identities/keys/types.ts";
import {
  connectedWalletPeer,
  encryptDecryptWithWallet,
  sendEncryptedMessage,
  sessionMessages,
} from "../lib/keys/connections/encryption.ts";
import type { WalletEncryptionRoundTrip } from "../lib/keys/connections/types.ts";
import { bytesToHex, truncate } from "../lib/ui/format.ts";

/**
 * Encryption with the CONNECTED REMOTE WALLET, with no self-owned key.
 *
 * The panel stays option-free until a wallet connects: only then does
 * the wallet's `did:key` identity (exchanged during the connect
 * handshake and mirrored into the IDENTITY store by the adapter, while
 * the connections store only contributes the session) provide the
 * `keyAgreement` key the shared secret is derived from.
 * The local half is the identity's NON-extractable X25519
 * companion key in the WebCrypto keystore: non-extractability blocks
 * export, not use, so the X25519 ECDH runs INSIDE `SubtleCrypto`
 * (`deriveBits` via the keystore's `deriveSharedSecret`) and only the
 * shared secret reaches the page, folding through HKDF into the
 * XChaCha20-Poly1305 channel key (see `../lib/keys/connections/encryption.ts`).
 * **Encrypt → Decrypt** seals a message into the exact wire frame the
 * connections messaging layer sends between the two parties, and
 * **Send to wallet** actually sends it end to end: the wallet decrypts
 * it with the same secret, ALERTS its user, and the acknowledgement
 * upgrades the message here from `delivered` to `acknowledged`.
 *
 * @param ctx - The provider context the connector carries (`adapter.provider`).
 */
export function WalletEncryptionPanel({ ctx }: { ctx: DappProvider }) {
  const sessions = useStore(connectionsStore, (state) => state.sessions);
  const identities = useStore(identityStore, (state) => state.identities);
  const keys = useStore(keyStore, (state) => state.keys);
  const messages = useStore(connectionsStore, (state) => state.messages);

  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("hello over the shared key");
  const [roundTrip, setRoundTrip] = useState<WalletEncryptionRoundTrip | null>(null);

  const peer = connectedWalletPeer(sessions, identities);
  const agreementKey = keys.find(isKeyAgreementKey);
  const walletName = peer?.session.peer?.metadata?.name ?? "Connected wallet";
  const walletDid = peer ? (peer.identity.did ?? peer.identity.address) : null;

  const encrypt = async () => {
    if (!peer || !agreementKey) return;
    setBusy(true);
    setError(null);
    try {
      // The ECDH runs inside WebCrypto on the non-extractable key; only
      // the 32-byte shared secret ever surfaces to the page, straight off
      // the provider's keystore extension, no wrapper in between.
      const sharedSecret = await ctx.key.store.deriveSharedSecret!(
        agreementKey.id,
        peer.remotePublicKey,
        true,
      );
      setRoundTrip(encryptDecryptWithWallet(sharedSecret, message));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!peer || !agreementKey) return;
    setSending(true);
    setError(null);
    try {
      // End to end: sealed here, decrypted by the wallet, ALERTED to its
      // user; the explicit acknowledgement flows back into the store.
      await sendEncryptedMessage(ctx, peer, agreementKey.id, message);
    } catch (cause) {
      // The wallet learns the local identity during the connect
      // handshake, so an identity minted afterwards needs a reconnect
      // before the wallet can derive the shared key.
      setError(
        (cause as { code?: string }).code === "secure_channel_unavailable"
          ? "The wallet has no secure channel for this session yet — it learns the local identity during the connect handshake, so reconnect (or let the session resume) after generating the identity key."
          : (cause as Error).message,
      );
    } finally {
      setSending(false);
    }
  };

  const sessionLog = peer ? sessionMessages(messages, peer.session.id) : [];

  return (
    <section className="card">
      <h2>
        Wallet Encryption{" "}
        {peer ? (
          <span className="chip supported">connected</span>
        ) : (
          <span className="chip unsupported">waiting for wallet</span>
        )}
      </h2>
      <p className="hint">
        The encryption key is derived from the connected wallet's identity — its DID document's{" "}
        <code>keyAgreement</code> key runs X25519 ECDH with the local identity's non-extractable
        keystore key (inside <code>SubtleCrypto</code>) into one shared XChaCha20-Poly1305 key, the
        same channel the connections messaging layer seals its frames with.
      </p>

      {!peer ? (
        <p className="empty">
          Nothing to encrypt with yet. Connect the <strong>Wallet Provider</strong> wallet — the
          shared key exists only between this page and the connected wallet's identity.
        </p>
      ) : !agreementKey ? (
        <p className="empty">
          The wallet is connected, but this page has no key-agreement key yet. Generate an{" "}
          <strong>identity key</strong> in the Local Keystore panel — it mints the non-extractable
          X25519 companion the shared secret is derived with.
        </p>
      ) : (
        <>
          <ul className="wallet-list">
            <li className="wallet">
              <div className="wallet-info">
                <span className="wallet-name">
                  {walletName} <span className="chip remote">remote</span>
                </span>
                {walletDid && (
                  <span className="wallet-account mono" title={walletDid}>
                    {truncate(walletDid)}
                  </span>
                )}
                <span className="wallet-account mono" title={bytesToHex(peer.remotePublicKey)}>
                  keyAgreement {truncate(bytesToHex(peer.remotePublicKey))}
                </span>
              </div>
            </li>
            <li className="wallet">
              <div className="wallet-info">
                <span className="wallet-name">
                  Local identity <span className="chip local">local</span>
                </span>
                <span className="wallet-account">
                  X25519 keyAgreement · non-extractable, ECDH runs in WebCrypto
                </span>
                <span
                  className="wallet-account mono"
                  title={bytesToHex(rawX25519PublicKey(agreementKey.publicKey!))}
                >
                  pub {truncate(bytesToHex(rawX25519PublicKey(agreementKey.publicKey!)))}
                </span>
              </div>
            </li>
          </ul>

          <h3>Secure channel round-trip</h3>
          <div className="roundtrip">
            <input
              className="mono"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="message to encrypt"
            />
            <button
              className="small"
              disabled={busy || message.length === 0}
              onClick={() => void encrypt()}
            >
              {busy ? "Sealing…" : "Encrypt → Decrypt"}
            </button>
            <button
              className="primary"
              disabled={sending || message.length === 0}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send to wallet"}
            </button>
          </div>
          {roundTrip && (
            <div className="output">
              <div className="mono">nonce {roundTrip.nonce}</div>
              <div className="mono" title={roundTrip.ciphertext}>
                ciphertext {truncate(roundTrip.ciphertext, 32, 12)}
              </div>
              <div className="mono">decrypted "{roundTrip.decrypted}"</div>
            </div>
          )}
          {error && <p className="output error">{error}</p>}

          {sessionLog.length > 0 && (
            <>
              <h3>Secure messages</h3>
              <ul className="message-list">
                {sessionLog.map((entry) => (
                  <li key={entry.id} className="message">
                    <div className="message-info">
                      <span className="message-text mono">{entry.text}</span>
                      <span className="message-meta">
                        {entry.direction === "outgoing" ? `to ${walletName}` : `from ${walletName}`}
                        {entry.error ? ` · ${entry.error}` : ""}
                      </span>
                    </div>
                    <span className={`chip message-status ${entry.status}`}>{entry.status}</span>
                  </li>
                ))}
              </ul>
              <p className="hint">
                <code>delivered</code> means the wallet decrypted and stored the message;{" "}
                <code>acknowledged</code> means its user confirmed the alert on the wallet.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
