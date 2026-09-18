import type { ConnectionSession } from "@algorandfoundation/connections";
import type { RemoteIdentity } from "../../identities/types.ts";

/**
 * The encryption counterpart resolved across the two domain stores: the
 * connected session (connections store), the wallet identity the channel
 * binds to (identity store, via the adapter-mirrored {@link RemoteIdentity}),
 * and the X25519 public key read from that identity's DID document.
 */
export interface WalletEncryptionPeer {
  /** The connected session the wallet identity arrived on. */
  session: ConnectionSession;
  /** The wallet identity the shared key is derived against. */
  identity: RemoteIdentity;
  /** The raw 32-byte X25519 key-agreement public key of the wallet. */
  remotePublicKey: Uint8Array;
}

/** The result of `encryptDecryptWithWallet` (see `encryption.ts`). */
export interface WalletEncryptionRoundTrip {
  /** The 24-byte XChaCha20 nonce, base64url (unpadded). */
  nonce: string;
  /** The sealed payload (ciphertext + Poly1305 tag), base64url (unpadded). */
  ciphertext: string;
  /** The plaintext recovered from the ciphertext. */
  decrypted: string;
}
