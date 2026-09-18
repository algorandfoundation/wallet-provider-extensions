/**
 * The session-scoped **remote mirror** of the credential store.
 *
 * Pure, connection-agnostic store code: a remote peer's credential
 * PRESENTATION METADATA lands in the same reactive store the local
 * credentials live in (tagged with the `metadata.source: "connection"`
 * discriminant plus the session id) and leaves again when the session
 * ends. The surface (`{ expose, receive, revoke }`) is mounted by
 * `WithCredentialsConnections` at `provider.credential.remote`, the
 * credentials side of the connections packages' domain seam.
 *
 * The wire type is {@link CredentialRecord}: the store's own
 * {@link Credential} minus the members that must not (or cannot
 * meaningfully) travel: the raw payload and parsed claims (disclosure
 * stays a deliberate OID4VP presentation flow) and the local-storage
 * timestamp.
 */

import { addCredential } from "@algorandfoundation/credentials-core";
import type { Credential, CredentialStoreState } from "@algorandfoundation/credentials-core";
import type { Store } from "@tanstack/store";

/**
 * The presentation-metadata twin of a {@link Credential}: the shape
 * credential records travel the wire in. No `raw` payload, no parsed
 * `claims` (claim disclosure stays a deliberate OID4VP flow), no local
 * `receivedAt`.
 *
 * @example
 * ```typescript
 * const record: CredentialRecord = {
 *   id: "cred-1",
 *   type: ["VerifiableCredential"],
 *   identityAddress: "did:key:z6Mk...",
 *   name: "Membership badge",
 *   format: "vc+sd-jwt",
 * };
 * ```
 */
export type CredentialRecord = Omit<Credential, "raw" | "claims" | "receivedAt">;

/**
 * The `metadata.source` discriminant session mirrors are tagged with.
 *
 * @example
 * ```typescript
 * const mirrored = credential.metadata?.source === REMOTE_CREDENTIAL_SOURCE;
 * ```
 */
export const REMOTE_CREDENTIAL_SOURCE: string = "connection";

/**
 * Whether a credential is a session mirror (see
 * {@link REMOTE_CREDENTIAL_SOURCE}); pass a `sessionId` to narrow to
 * one session's records.
 *
 * @example
 * ```typescript
 * const local = store.state.credentials.filter((c) => !isRemoteCredential(c));
 * const fromPeer = store.state.credentials.filter((c) => isRemoteCredential(c, "session-1"));
 * ```
 */
export function isRemoteCredential(credential: Credential, sessionId?: string): boolean {
  if (credential.metadata?.source !== REMOTE_CREDENTIAL_SOURCE) return false;
  return sessionId === undefined || credential.metadata?.sessionId === sessionId;
}

/**
 * The remote-mirror surface mounted at `provider.credential.remote`.
 *
 * @example
 * ```typescript
 * const remote: RemoteCredentialsMirror = provider.credential.remote;
 * session.send(remote.expose());
 * remote.receive(session.id, peerRecords);
 * ```
 */
export interface RemoteCredentialsMirror {
  /**
   * The local credentials as presentation-metadata records, which is what this
   * side shares with a peer. Session mirrors are excluded (no echo) and
   * `raw`/`claims`/`receivedAt` are stripped along with any function
   * members.
   */
  expose(): CredentialRecord[];
  /**
   * Mirrors a peer's credential metadata into the store, tagged with
   * the `metadata.source`/`metadata.sessionId` discriminant. Replaces
   * the session's previous mirror.
   */
  receive(sessionId: string, records: CredentialRecord[]): void;
  /** Removes exactly the session's mirrored credentials. */
  revoke(sessionId: string): void;
}

/** Strips function members; records travel the wire as data only. */
function toDataRecord<T>(record: T): T {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(
      ([, value]) => typeof value !== "function",
    ),
  ) as T;
}

/** Projects a stored credential onto its wire twin. */
function toCredentialRecord(credential: Credential): CredentialRecord {
  const {
    raw: _raw,
    claims: _claims,
    receivedAt: _receivedAt,
    ...record
  } = toDataRecord(credential);
  return record;
}

/**
 * Creates the credential store's session-scoped remote mirror.
 *
 * @param store - The TanStack store instance backing the credential state.
 * @returns The {@link RemoteCredentialsMirror}.
 *
 * @example
 * ```typescript
 * const remote = remoteCredentialsMirror(store);
 * remote.receive("session-1", peerCredentialMetadata);
 * // ... the peer's inventory renders from the same store ...
 * remote.revoke("session-1");
 * ```
 */
export function remoteCredentialsMirror(
  store: Store<CredentialStoreState>,
): RemoteCredentialsMirror {
  const revoke = (sessionId: string): void => {
    store.setState((state: CredentialStoreState): CredentialStoreState => {
      const credentials = state.credentials.filter(
        (credential) => !isRemoteCredential(credential, sessionId),
      );
      if (credentials.length === state.credentials.length) return state;
      return { ...state, credentials };
    });
  };

  return {
    expose(): CredentialRecord[] {
      return store.state.credentials
        .filter((credential) => !isRemoteCredential(credential))
        .map(toCredentialRecord);
    },

    receive(sessionId: string, records: CredentialRecord[]): void {
      // Replace the session's previous mirror before adding the fresh records.
      revoke(sessionId);
      const receivedAt = Date.now();
      for (const record of records) {
        const data = toDataRecord(record);
        addCredential({
          store,
          credential: {
            ...data,
            // Metadata only: the raw payload never travels the wire.
            raw: "",
            receivedAt,
            metadata: {
              ...data.metadata,
              source: REMOTE_CREDENTIAL_SOURCE,
              sessionId,
            },
          },
        });
      }
    },

    revoke,
  };
}
