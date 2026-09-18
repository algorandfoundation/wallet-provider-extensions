import { useStore } from "@tanstack/react-store";
import { connectionsStore } from "../stores/connectionsStore.ts";
import { truncate } from "../lib/ui/format.ts";

/** Human label + chip styling per reactive session status. */
const SESSION_STATUS: Record<string, { label: string; chip: string }> = {
  connected: { label: "connected", chip: "chip supported" },
  connecting: { label: "reconnecting…", chip: "chip unsupported" },
  disconnected: { label: "disconnected", chip: "chip" },
};

/**
 * Surfaces the state of the Liquid Auth wallet session. The connect flow
 * itself starts from the Accounts section: clicking **Connect** on the
 * "Wallet Provider" wallet pops the `liquid://` QR modal (see
 * `ConnectModal.tsx`), and once the wallet scans it this panel shows the
 * established session: the peer's name and the reactive status the
 * auto-resume watcher flips through on transport drops.
 */
export function ConnectionPanel() {
  // The reactive session list; a resume flips the wallet session through
  // `connecting` (parked on the signaling service) back to `connected`.
  const sessions = useStore(connectionsStore, (state) => state.sessions);
  // The wallet session (at most one in this example), the one carrying
  // the wallet's accounts from the connect handshake.
  const session = sessions.find((s) => s.peer?.domains?.accounts?.length) ?? null;
  const status = session ? (SESSION_STATUS[session.status] ?? null) : null;

  return (
    <section className="card">
      <h2>
        Liquid Auth Connection {status && <span className={status.chip}>{status.label}</span>}
      </h2>
      {session ? (
        <>
          {session.status === "connecting" && (
            <p className="hint">
              Parked on the signaling service — the connection re-establishes as soon as the wallet
              is online (no QR, no passkey).
            </p>
          )}
          <ul className="kv-list">
            <li>
              <span className="label">Wallet</span>
              <span>{session.peer?.metadata?.name ?? "Unknown wallet"}</span>
            </li>
            <li>
              <span className="label">Session</span>
              <span className="mono">{truncate(session.id)}</span>
            </li>
            <li>
              <span className="label">Accounts</span>
              <span>{session.peer?.domains?.accounts?.length ?? 0}</span>
            </li>
          </ul>
        </>
      ) : (
        <p className="empty">
          No wallet session yet — click <strong>Connect</strong> on the "Wallet Provider" wallet in
          the Accounts section to pop the <code>liquid://</code> QR modal, then scan it with the
          wallet.
        </p>
      )}
    </section>
  );
}
