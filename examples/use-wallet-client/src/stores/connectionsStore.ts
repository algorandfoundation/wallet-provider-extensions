import { Store } from "@tanstack/store";
import type { ConnectionsState } from "@algorandfoundation/connections";

/**
 * The reactive store backing the Provider's connection sessions, the
 * CONNECTIONS domain's single source of truth. Exported so React panels
 * can subscribe to session and message changes.
 *
 * The connected session's `peer` snapshots what the wallet exposed during
 * the connect handshake (accounts, identities, passkey/credential
 * metadata), but that snapshot is the ADAPTER's input, not the page's:
 * the adapter mirrors each slice into its own domain store (identity,
 * passkeys, credential stores; see `../lib/provider/adapter.ts`), and
 * the panels read those stores, never `session.peer.*`.
 */
export const connectionsStore = new Store<ConnectionsState>({ sessions: [], messages: [] });
