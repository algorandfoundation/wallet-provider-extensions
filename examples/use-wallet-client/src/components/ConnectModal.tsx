import { useEffect, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { generateQRCode } from "@algorandfoundation/liquid-client";
import { buildLiquidUri } from "@algorandfoundation/connections";
import { connectionsStore } from "../stores/connectionsStore.ts";
import { pendingRequestSession } from "../lib/ui/pendingRequest.ts";

/**
 * The Liquid Auth QR pop-up: a modal overlay, like the QR modal Pera's
 * connect library opens. Clicking **Connect** on the "Wallet Provider"
 * wallet parks the out-of-band request as a peerless `pending`/
 * `connecting` session in the CONNECTIONS STORE (its id is the request
 * id), and this modal simply observes the store with no side bridge: it
 * pops over the whole page with the `liquid://` QR for cross-device
 * scanning, always reachable regardless of which domains the
 * provider-determined render currently shows.
 *
 * The pending connect resolves once the wallet scans the code and joins
 * the signaling room; the modal closes itself when the attempt settles
 * (the session leaves its peerless waiting state; see
 * `../lib/ui/pendingRequest.ts`). Closing it manually (×, backdrop, or
 * Escape) only hides the QR; the connect keeps waiting.
 */
export function ConnectModal() {
  const sessions = useStore(connectionsStore, (state) => state.sessions);
  const pending = pendingRequestSession(sessions);
  // Manual dismissal hides THIS attempt's QR only; a fresh connect
  // parks a new session id and re-opens the modal.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const request = pending && pending.id !== dismissedId ? pending : null;
  // The liquid:// URI is fully derivable from the session record: the
  // requester parked on its signaling origin under the request id.
  const uri = request ? buildLiquidUri(request.origin, request.id) : null;

  useEffect(() => {
    let active = true;
    setQrDataUrl(null);
    if (!request) return;
    // liquid-client renders the styled liquid:// QR (object URL png).
    generateQRCode({ requestId: request.id, url: request.origin })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch((error) => {
        console.error("Failed to render the liquid:// QR code:", error);
      });
    return () => {
      active = false;
    };
  }, [request?.id, request?.origin]);

  // Escape dismisses the modal, like any dialog.
  useEffect(() => {
    if (!request) return;
    const requestId = request.id;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissedId(requestId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request?.id]);

  if (!request) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        // Only direct backdrop clicks dismiss; clicks inside the dialog
        // land on .modal and never match currentTarget.
        if (event.target === event.currentTarget) setDismissedId(request.id);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="connect-modal-title">
        <header className="modal-header">
          <h2 id="connect-modal-title">Connect a wallet</h2>
          <button
            className="modal-close"
            onClick={() => setDismissedId(request.id)}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <p className="hint">
          Scan the QR (or paste the URI) with your wallet. The pending connection completes
          automatically once the wallet joins.
        </p>
        <div className="qr-fallback">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="liquid:// connection QR" className="qr-image" width={240} />
          ) : (
            <p className="hint">Rendering QR…</p>
          )}
          <code className="mono qr-uri">{uri}</code>
        </div>
        <div className="actions modal-actions">
          <button className="small ghost" onClick={() => navigator.clipboard?.writeText(uri ?? "")}>
            Copy URI
          </button>
        </div>
      </div>
    </div>
  );
}
