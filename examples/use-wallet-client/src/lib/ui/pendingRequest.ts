/**
 * The pending connect request, read straight off the connections store
 * with no side bridge: when a connect starts, the protocol requester upserts
 * the out-of-band request as a session (its id IS the request id) in
 * `pending`, flipping to `connecting` while it waits for the wallet. So
 * "a connect is waiting to be scanned" is simply a session in one of
 * those states that has no `peer` yet; a resume keeps the peer of the
 * previous handshake and therefore never re-opens the QR. The attempt
 * settling (`connected`, `failed`, or `disconnected` on abort) closes
 * the modal through the same observation.
 */

import type { ConnectionSession } from "@algorandfoundation/connections";

/** The latest session still waiting on its out-of-band request, if any. */
export function pendingRequestSession(sessions: ConnectionSession[]): ConnectionSession | null {
  const pending = sessions.filter(
    (session) => !session.peer && (session.status === "pending" || session.status === "connecting"),
  );
  if (pending.length === 0) return null;
  return pending.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
}
