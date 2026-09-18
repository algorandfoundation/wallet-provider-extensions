/**
 * Seamless session resume for the dapp side of the connection.
 *
 * A resume "parks" on the session's liquid-auth signaling rendezvous:
 * the server resolves the link as soon as the wallet is (or comes)
 * online, the wallet re-offers, and the engine re-runs the `connect`
 * handshake on the fresh transport. The wallet auto-re-offers on
 * presence, so a parked resume is exactly "listening to the service
 * for offers": it waits indefinitely and only FAILS on actual
 * signaling errors.
 *
 * This module drives that in two places:
 *
 * - {@link kickResume}: the initial page-load resume of the persisted
 *   wallet session (kicked by the connector in `../provider/adapter.ts`).
 * - {@link installAutoResume}: re-parks automatically whenever a live
 *   transport drops (the engine marks the session `disconnected` in the
 *   store when its transport closes; that transition is the signal).
 *
 * Intentional disconnects are exempt: the adapter's disconnect path
 * calls {@link suspendAutoResume} first (directly; the connector in
 * `../provider/adapter.ts` owns this wiring), and the suspension is
 * re-armed as soon as the session flips back to `connecting`/`connected`
 * through a fresh connect.
 */

import type { Store } from "@tanstack/store";
import type {
  ConnectionSessionStatus,
  ConnectionsState,
  WebConnectionApi,
} from "@algorandfoundation/connections";

/**
 * The resume slice of the upstream connection API (`provider.connection`
 * implements the full `WebConnectionApi`), which is all this module drives.
 */
type ResumeApi = Pick<WebConnectionApi, "resume">;

/** First retry delay after a failed resume attempt. */
const BASE_RETRY_MS = 1_000;

/** Retry delay cap: the backoff doubles up to here, then stays. */
const MAX_RETRY_MS = 30_000;

/** Session ids the app intentionally disconnected, so no auto-resume. */
const suspended = new Set<string>();

/** Session ids with a resume attempt (or its retry loop) in flight. */
const inFlight = new Set<string>();

/** The connection API {@link installAutoResume} bound resumes to. */
let connection: ResumeApi | null = null;

/**
 * Marks a session as intentionally disconnected so the upcoming
 * `connected` → `disconnected` transition is NOT auto-resumed. Cleared
 * again when the session reconnects through a fresh connect/resume.
 */
export function suspendAutoResume(sessionId: string): void {
  suspended.add(sessionId);
}

/**
 * Kicks a background resume of the session (fire-and-forget): parks on
 * the signaling rendezvous and, on actual signaling failures, retries
 * with capped exponential backoff. Single-flight per session id:
 * redundant kicks while an attempt is running are no-ops (the engine
 * additionally single-flights concurrent `resume()` calls).
 */
export function kickResume(sessionId: string): void {
  void attemptResume(sessionId);
}

/** Resolves after the given delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The resume loop behind {@link kickResume}: one parked resume at a
 * time, retried with exponential backoff (1s, 2s, 4s, … capped at 30s)
 * until it succeeds or the session gets suspended. Never rejects.
 */
async function attemptResume(sessionId: string): Promise<void> {
  if (!connection || inFlight.has(sessionId) || suspended.has(sessionId)) return;
  inFlight.add(sessionId);
  let delay = BASE_RETRY_MS;
  try {
    // A parked resume waits indefinitely for the wallet to re-offer, so
    // this loop only spins on actual signaling failures.
    while (!suspended.has(sessionId)) {
      try {
        await connection.resume(sessionId);
        return; // Success; the next drop starts a fresh backoff.
      } catch (error) {
        console.warn(`Auto-resume of session ${sessionId} failed; retrying in ${delay}ms`, error);
        await sleep(delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      }
    }
  } finally {
    inFlight.delete(sessionId);
  }
}

/**
 * Watches the connections store and re-parks a session on the signaling
 * rendezvous whenever its live transport drops unexpectedly, i.e. on a
 * `connected` → `disconnected` transition that was not preceded by a
 * {@link suspendAutoResume} call.
 *
 * @param connectionApi - The connection API (`provider.connection`) whose `resume` re-establishes sessions.
 * @param store - The reactive connections store to watch (see `../../stores/connectionsStore.ts`).
 * @returns An uninstall function (unsubscribes from the store).
 */
export function installAutoResume(
  connectionApi: ResumeApi,
  store: Store<ConnectionsState>,
): () => void {
  connection = connectionApi;

  // Snapshot of the last seen status per session id, so transitions
  // (not just current states) drive the resume decision.
  const previous = new Map<string, ConnectionSessionStatus>();
  for (const session of store.state.sessions) previous.set(session.id, session.status);

  const subscription = store.subscribe(() => {
    for (const session of store.state.sessions) {
      const before = previous.get(session.id);
      previous.set(session.id, session.status);
      if (session.status === before) continue;

      // A connect or resume went through; re-arm auto-resume for this id.
      if (session.status === "connecting" || session.status === "connected") {
        suspended.delete(session.id);
        continue;
      }

      // A live transport dropped unexpectedly; re-park immediately.
      if (before === "connected" && session.status === "disconnected") {
        if (!suspended.has(session.id)) kickResume(session.id);
      }
    }
  });
  return () => subscription.unsubscribe();
}
