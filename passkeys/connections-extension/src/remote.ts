/**
 * The session-scoped **remote mirror** of the passkeys store.
 *
 * Pure, connection-agnostic store code: the metadata of a remote peer's
 * passkeys (e.g. the passkeys a connected wallet holds) is written into
 * the same reactive store the local feeders fill, and leaves again when
 * the session ends. The surface (`{ expose, receive, revoke }`) is
 * mounted by `WithPasskeysConnections` at `provider.passkey.remote`,
 * the passkeys side of the connections packages' domain seam. The
 * receive context is a **type-only** import of the seam's
 * `DomainReceiveContext` (`@algorandfoundation/connections-core`), so
 * no runtime dependency exists in either direction.
 *
 * The wire type is simply {@link Passkey}: the store already holds
 * nothing but public credential metadata (key material never crosses
 * into it), so records travel as-is. `expose` reads the store minus the
 * mirrored records, so a peer's records never echo back to the peer
 * that shared them.
 */

import { addPasskey, removePasskey } from "@algorandfoundation/passkeys-core";
import type { Passkey, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { DomainReceiveContext } from "@algorandfoundation/connections-core";
import type { Store } from "@tanstack/store";

/**
 * The remote-mirror surface mounted at `provider.passkey.remote`.
 *
 * @example
 * ```typescript
 * const shared = provider.passkey.remote.expose(); // what this side shares
 * provider.passkey.remote.receive(sessionId, peerRecords); // mirror a peer
 * provider.passkey.remote.revoke(sessionId); // session ended
 * ```
 */
export interface RemotePasskeysMirror {
  /**
   * The local passkeys as data-only records: what this side shares with
   * a peer. Session mirrors never echo back (their credential ids are
   * filtered out).
   */
  expose(): Passkey[];
  /**
   * Mirrors a peer's passkey metadata into the store for the session,
   * replacing the session's previous mirror. Records whose credential
   * id already belongs to a local passkey are skipped (locals win).
   * The context is accepted for seam compatibility and unused: passkey
   * records carry no re-attachable behavior.
   */
  receive(sessionId: string, records: Passkey[], context?: DomainReceiveContext): void;
  /** Drops the session's mirror from the store. */
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
 * Creates the passkeys store's session-scoped remote mirror.
 *
 * `receive` writes a peer's records into the store (skipping credential
 * ids a local passkey already claims, so locals win on collisions) and
 * tracks which ids each session owns; `revoke` removes the session's
 * records again unless another session still mirrors them. When a
 * mirrored record disappears from the store through any other path
 * (e.g. a UI removal), the mirror's tracking is pruned reactively so
 * `expose` never hides a record a local feeder re-adds later.
 *
 * @param store - The TanStack store instance backing the passkeys state.
 * @returns The {@link RemotePasskeysMirror}.
 *
 * @example
 * ```typescript
 * const store = new Store<PasskeysState>({ passkeys: [] });
 * const remote = remotePasskeysMirror(store);
 * remote.receive("session-1", walletPasskeys);
 * // ... the wallet's passkeys ride the same reactive store ...
 * remote.revoke("session-1");
 * ```
 */
export function remotePasskeysMirror(store: Store<PasskeysState>): RemotePasskeysMirror {
  /** Session id → the credential ids the session's mirror owns. */
  const mirrored = new Map<string, Set<string>>();

  const mirroredIds = (): Set<string> => {
    const ids = new Set<string>();
    for (const sessionIds of mirrored.values()) {
      for (const id of sessionIds) ids.add(id);
    }
    return ids;
  };

  // Prune tracking when a mirrored record leaves the store through any
  // other path (UI removal, clear): the id is no longer mirror-owned.
  store.subscribe(() => {
    const present = new Set(store.state.passkeys.map((passkey) => passkey.credentialId));
    for (const sessionIds of mirrored.values()) {
      for (const id of sessionIds) {
        if (!present.has(id)) sessionIds.delete(id);
      }
    }
  });

  const drop = (sessionId: string): void => {
    const sessionIds = mirrored.get(sessionId);
    if (!sessionIds) return;
    mirrored.delete(sessionId);
    const stillMirrored = mirroredIds();
    for (const credentialId of sessionIds) {
      if (stillMirrored.has(credentialId)) continue;
      removePasskey({ store, credentialId });
    }
  };

  return {
    expose(): Passkey[] {
      const remote = mirroredIds();
      return store.state.passkeys
        .filter((passkey) => !remote.has(passkey.credentialId))
        .map(toDataRecord);
    },

    receive(sessionId: string, records: Passkey[]): void {
      drop(sessionId);
      const local = new Set(
        store.state.passkeys
          .map((passkey) => passkey.credentialId)
          .filter((id) => !mirroredIds().has(id)),
      );
      const sessionIds = new Set<string>();
      for (const record of records) {
        const data = toDataRecord(record);
        // Locals win on credential-id collisions.
        if (local.has(data.credentialId)) continue;
        addPasskey({ store, passkey: data });
        sessionIds.add(data.credentialId);
      }
      mirrored.set(sessionId, sessionIds);
    },

    revoke(sessionId: string): void {
      drop(sessionId);
    },
  };
}
