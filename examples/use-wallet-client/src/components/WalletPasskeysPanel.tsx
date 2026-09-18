import { useStore } from "@tanstack/react-store";
import { passkeysStore } from "../stores/passkeysStore.ts";
import { truncate } from "../lib/ui/format.ts";

/**
 * The passkeys DOMAIN panel: it reads the passkeys store, the domain's
 * single source of truth, never the connections store.
 *
 * The records are the passkey metadata the connected wallet exposed over
 * the connect handshake's `passkeys` domain: the connections engine feeds
 * it through the passkeys store's session-scoped `remote` mirror for the
 * session's lifetime. Metadata only; key material stays in the wallet.
 */
export function WalletPasskeysPanel() {
  const passkeys = useStore(passkeysStore, (state) => state.passkeys);

  return (
    <section className="card">
      <h2>
        Wallet Passkeys <span className="chip remote">remote</span>
      </h2>
      <p className="hint">
        Passkey descriptors synced from the connected wallet into the passkeys store — the domain's
        one source of truth, mirrored by the adapter for the session's lifetime (key material never
        leaves the wallet).
      </p>

      {passkeys.length === 0 ? (
        <p className="empty">Nothing yet. Connect the Wallet Provider to pull the inventory in.</p>
      ) : (
        <ul className="wallet-list">
          {passkeys.map((passkey) => (
            <li key={passkey.credentialId} className="wallet">
              <div className="wallet-info">
                <span className="wallet-name">
                  Passkey · {passkey.rpId ?? passkey.origin ?? "unknown RP"}
                </span>
                <span className="wallet-account mono" title={passkey.credentialId}>
                  {truncate(passkey.credentialId)}
                </span>
                {(passkey.userName || passkey.createdAt) && (
                  <span className="wallet-account">
                    {passkey.userName ?? "—"}
                    {passkey.createdAt
                      ? ` · created ${new Date(passkey.createdAt).toLocaleDateString()}`
                      : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
