import type { Identity } from "@algorandfoundation/identities";

/**
 * An identity minted from the local browser keystore: its signing key
 * lives in IndexedDB-backed WebCrypto storage, and its `metadata.keyId`
 * points back at the keystore record (see `localIdentities.ts`).
 * `metadata.agreementKeyId` points at the identity's companion X25519
 * key-agreement key, the non-extractable key whose ECDH runs inside
 * WebCrypto (see `../keys/connections/encryption.ts`).
 */
export interface LocalIdentity extends Identity {
  metadata: {
    source: "local";
    keyId: string;
    agreementKeyId?: string;
    [key: string]: unknown;
  };
}

/**
 * An identity synced from the connected wallet: it rides the connect
 * handshake (`session.peer.domains.identities`) and lives for the
 * session (the connections engine feeds it through the identity store's
 * remote mirror and revokes it again on disconnect).
 */
export interface RemoteIdentity extends Identity {
  metadata: { source: "connection"; sessionId: string; [key: string]: unknown };
}

/**
 * Every identity this dapp keeps (ONE store, N concrete types), mirroring
 * the accounts store pattern: the union members are narrowed back via
 * their `metadata.source` discriminant (see {@link isLocalIdentity}).
 */
export type DappIdentity = LocalIdentity | RemoteIdentity;

/** Narrows a {@link DappIdentity} to the locally minted variant. */
export function isLocalIdentity(identity: DappIdentity): identity is LocalIdentity {
  return identity.metadata?.source === "local";
}

/** Narrows a {@link DappIdentity} to the wallet-synced variant. */
export function isRemoteIdentity(identity: DappIdentity): identity is RemoteIdentity {
  return identity.metadata?.source === "connection";
}
