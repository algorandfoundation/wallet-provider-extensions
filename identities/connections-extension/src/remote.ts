/**
 * The session-scoped **remote mirror** of the identity store.
 *
 * Pure, connection-agnostic store code: a remote peer's identities land
 * in the same reactive store the local identities live in (tagged with
 * the `metadata.source: "connection"` discriminant plus the session id)
 * and leave again when the session ends. The surface
 * (`{ expose, receive, revoke }`) is mounted by `WithIdentitiesConnections`
 * at `provider.identity.remote`, the identities side of the connections
 * packages' domain seam. The receive context is a **type-only** import
 * of the seam's `DomainReceiveContext`
 * (`@algorandfoundation/connections-core`), so no runtime dependency
 * exists in either direction.
 *
 * The wire type is `IdentityRecord`
 * (`@algorandfoundation/identities-core`): the store's own `Identity`
 * minus its only non-data member, `sign`. Behavior never travels the
 * wire: what differs between a local and a remote identity is how
 * `sign` is backed (keystore material locally vs a session-routed RPC),
 * so `receive` re-attaches the signer the caller passes in its context.
 */

import { addIdentity } from "@algorandfoundation/identities-core";
import type {
  BaseIdentity,
  Identity,
  IdentityRecord,
  IdentityStoreState,
} from "@algorandfoundation/identities-core";
import type { DomainReceiveContext } from "@algorandfoundation/connections-core";
import type { Store } from "@tanstack/store";

/**
 * The `metadata.source` discriminant session mirrors are tagged with,
 * the same convention local identities use with `source: "local"`.
 */
export const REMOTE_IDENTITY_SOURCE: string = "connection";

/**
 * Whether an identity is a session mirror (see
 * {@link REMOTE_IDENTITY_SOURCE}); pass a `sessionId` to narrow to one
 * session's records.
 */
export function isRemoteIdentity(identity: BaseIdentity, sessionId?: string): boolean {
  if (identity.metadata?.source !== REMOTE_IDENTITY_SOURCE) return false;
  return sessionId === undefined || identity.metadata?.sessionId === sessionId;
}

/**
 * The remote-mirror surface mounted at `provider.identity.remote`.
 */
export interface RemoteIdentitiesMirror {
  /**
   * The local identities as data-only records: what this side shares
   * with a peer. Session mirrors are excluded (no echo) and function
   * members (`sign`) are stripped: public fields and DID documents
   * only, never signers.
   */
  expose(): IdentityRecord[];
  /**
   * Mirrors a peer's identities into the store, tagged with the
   * `metadata.source`/`metadata.sessionId` discriminant and with `sign`
   * re-attached from the context per record. Replaces the session's
   * previous mirror.
   */
  receive(sessionId: string, records: IdentityRecord[], context?: DomainReceiveContext): void;
  /** Removes exactly the session's mirrored identities. */
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

/**
 * Creates the identity store's session-scoped remote mirror.
 *
 * @param store - The TanStack store instance backing the identity state.
 * @returns The {@link RemoteIdentitiesMirror}.
 *
 * @example
 * ```typescript
 * const remote = remoteIdentitiesMirror(store);
 * remote.receive("session-1", peerIdentities, { sign: sessionSigner });
 * // ... the peer's identities sit next to the local ones ...
 * remote.revoke("session-1");
 * ```
 */
export function remoteIdentitiesMirror<
  T extends BaseIdentity = Identity,
  S extends IdentityStoreState<T> = IdentityStoreState<T>,
>(store: Store<S>): RemoteIdentitiesMirror {
  const revoke = (sessionId: string): void => {
    store.setState((state: S): S => {
      const identities = state.identities.filter(
        (identity) => !isRemoteIdentity(identity, sessionId),
      );
      if (identities.length === state.identities.length) return state;
      return { ...state, identities } as S;
    });
  };

  return {
    expose(): IdentityRecord[] {
      return store.state.identities
        .filter((identity) => !isRemoteIdentity(identity))
        .map((identity) => toDataRecord(identity) as IdentityRecord);
    },

    receive(sessionId: string, records: IdentityRecord[], context?: DomainReceiveContext): void {
      // Replace the session's previous mirror before adding the fresh records.
      revoke(sessionId);
      for (const record of records) {
        const data = toDataRecord(record);
        const identity = {
          ...data,
          type: data.type ?? "did:key",
          ...(context?.sign ? { sign: context.sign(data) } : {}),
          metadata: {
            ...data.metadata,
            source: REMOTE_IDENTITY_SOURCE,
            sessionId,
          },
        } as unknown as T;
        addIdentity<T, S>({ store, identity });
      }
    },

    revoke,
  };
}
