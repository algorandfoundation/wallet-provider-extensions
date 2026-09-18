/**
 * Presence-driven seamless resume of persisted Liquid Auth sessions.
 *
 * After the FIRST QR pairing (with its FIDO2 ceremony), reconnecting
 * needs no new scan and no new passkey assertion. Four pieces make that
 * work end to end:
 *
 * 1. **The server re-announces on reconnect**: the liquid-auth service
 *    persists `{ wallet, requestId }` in the wallet's origin-scoped
 *    cookie session; when the wallet's signaling socket (re)connects it
 *    rejoins the request room, re-announces `auth` (resolving a dapp
 *    parked on `link`), and broadcasts `presence`
 *    (`{ requestId, deviceCount, online }`) to the room on every
 *    join/leave.
 * 2. **Presence tells the wallet when to act**: this orchestrator
 *    brings the persistent signaling socket up for every origin with a
 *    persisted session (`module.start(origin)`), listens for `presence`,
 *    and when a known-but-not-connected session's room shows
 *    `deviceCount >= 2` (wallet + waiting dapp) it resumes silently.
 * 3. **The native offerer re-binds the session**: the native module's
 *    `peer(..., "answer")` emits a fire-and-forget `link(requestId)`
 *    BEFORE sending the fresh WebRTC offer, re-binding the authenticated
 *    origin session to that requestId, so re-offers reach the right room
 *    and no fresh passkey assertion is needed to switch sessions.
 * 4. **`/auth/session` gates the ceremony**: the ceremony seam
 *    (`lib/liquidAuthFlow.ts`) skips the passkey sheet whenever the
 *    server session already authenticates this wallet; the orchestrator
 *    additionally checks {@link isSessionAuthenticated} UP FRONT and
 *    refuses to auto-resume otherwise, so a background resume can never
 *    pop a spontaneous system passkey sheet; an expired server session
 *    is recovered through the manual Resume action on the connections
 *    screen instead.
 *
 * The resume's `connect` RPC handshake auto-approves: the liquid-auth
 * responder tags every resumed transport's handshake with a
 * `ConnectApprovalContext` (`resumed: true`), which the wallet's
 * `approveConnect` in `lib/connections.ts` honors: a resume
 * renegotiates an already-approved pairing; only brand-new pairings
 * prompt.
 */
import type { ConnectionSession } from "@algorandfoundation/connections";

import { connectionsStore } from "@/stores/connections";
import type { ReactNativeProvider } from "@/providers/ReactNativeProvider";
import { liquidAuthAccount } from "./connections";
import { isSessionAuthenticated } from "./liquidAuthFlow";

/** How long a session waits after a failed/skipped attempt before retrying. */
const RESUME_COOLDOWN_MS = 15_000;

/** A server `presence` broadcast for a request room. */
interface PresenceEvent {
  requestId: string;
  deviceCount: number;
}

/**
 * The subset of `react-native-liquid-auth`'s surface the orchestrator
 * consumes (structural, so tests inject doubles).
 */
export interface ConnectionResumeModule {
  /** Starts (and binds) the persistent signaling socket against an origin. */
  start(url: string): Promise<void>;
  /** Subscribes to server-broadcast `presence` updates. */
  addPresenceListener(listener: (event: PresenceEvent) => void): { remove(): void };
  /** Snapshot of the background service's state (cached `lastPresence` etc.). */
  getConnectionState(): { lastPresence?: PresenceEvent | null };
}

/** Options accepted by {@link installConnectionResume}. */
export interface InstallConnectionResumeOptions {
  /** The app's provider (its connections engine drives the resume). */
  provider: ReactNativeProvider;
  /** The native `react-native-liquid-auth` module surface. */
  module: ConnectionResumeModule;
}

/**
 * Resumes a session. This is the one entry point both the presence
 * orchestrator and the connections screen go through. The `connect`
 * handshake of a resume never re-raises the approval dialog: the
 * responder tags it `resumed` and the wallet's `approveConnect`
 * auto-approves (see `lib/connections.ts`), which also covers the
 * handshake landing only after this call has resolved.
 */
export async function resumeConnection(
  provider: ReactNativeProvider,
  sessionId: string,
): Promise<ConnectionSession> {
  return provider.connection.resume(sessionId);
}

/**
 * Installs the presence-driven auto-resume (see the module header for
 * the full design). Call once after the provider is constructed; the
 * setup waits for `provider.connection.ready` internally.
 *
 * @returns An uninstall function removing the listeners.
 */
export function installConnectionResume({
  provider,
  module,
}: InstallConnectionResumeOptions): () => void {
  let disposed = false;
  let subscription: { remove(): void } | null = null;
  // Local single-flight per session id (the engine also single-flights,
  // but skipping early avoids redundant `/auth/session` round-trips).
  const inFlight = new Set<string>();
  const lastAttemptAt = new Map<string, number>();

  const resumable = (session: ConnectionSession | undefined): session is ConnectionSession =>
    !!session &&
    session.status !== "connected" &&
    session.status !== "authenticating" &&
    session.status !== "connecting";

  const maybeResume = async (presence: PresenceEvent): Promise<void> => {
    // deviceCount >= 2 means someone besides this wallet (the waiting
    // dapp) is in the request room.
    if (disposed || presence.deviceCount < 2) return;
    const session = connectionsStore.state.sessions.find((s) => s.id === presence.requestId);
    if (!resumable(session) || inFlight.has(session.id)) return;
    const last = lastAttemptAt.get(session.id);
    if (last !== undefined && Date.now() - last < RESUME_COOLDOWN_MS) return;
    inFlight.add(session.id);
    lastAttemptAt.set(session.id, Date.now());
    try {
      let address: string;
      try {
        ({ address } = liquidAuthAccount());
      } catch {
        // No keystore-backed account yet, so nothing to authenticate as.
        return;
      }
      // Only resume while the server's cookie session still authenticates
      // this wallet: anything else would run the ceremony and pop a
      // spontaneous passkey sheet. Leave the session disconnected for a
      // manual Resume instead.
      if (!(await isSessionAuthenticated(session.origin, address))) return;
      await resumeConnection(provider, session.id);
      lastAttemptAt.delete(session.id);
    } catch (error) {
      console.warn(`auto-resume of session ${session.id} failed:`, error);
    } finally {
      inFlight.delete(session.id);
    }
  };

  const setup = async (): Promise<void> => {
    await provider.connection.ready;
    if (disposed) return;
    subscription = module.addPresenceListener((event) => void maybeResume(event));
    // One persistent signaling socket per known origin: connecting it is
    // what makes the server rejoin the request room from the wallet's
    // cookie session, re-announce `auth`, and start broadcasting
    // `presence`. Fire-and-forget: an unreachable origin only logs.
    const origins = new Set(connectionsStore.state.sessions.map((s) => s.origin));
    for (const origin of origins) {
      module.start(origin).catch((error) => {
        console.warn(`signaling start for ${origin} failed:`, error);
      });
    }
    // The presence broadcast may have fired before the listener attached
    // (e.g. a still-running background service reconnected during app
    // startup), so replay the cached value.
    const cached = module.getConnectionState().lastPresence;
    if (cached) void maybeResume(cached);
  };

  void setup();

  return () => {
    disposed = true;
    subscription?.remove();
    subscription = null;
  };
}
