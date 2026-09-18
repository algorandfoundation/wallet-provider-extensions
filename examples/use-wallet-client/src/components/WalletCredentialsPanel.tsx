import { useStore } from "@tanstack/react-store";
import { credentialsStore } from "../stores/credentialsStore.ts";
import { truncate } from "../lib/ui/format.ts";

/**
 * The credentials DOMAIN panel: it reads the credential store, the domain's
 * single source of truth, never the connections store.
 *
 * The records are the credential metadata the connected wallet exposed
 * over the connect handshake's `credentials` domain: the connections
 * engine records it through the credential store's session-scoped
 * `remote` mirror for the session's lifetime. Metadata only; raw
 * credential payloads and claims stay in the wallet; disclosure remains
 * a deliberate presentation (OID4VP) flow.
 */
export function WalletCredentialsPanel() {
  const credentials = useStore(credentialsStore, (state) => state.credentials);

  return (
    <section className="card">
      <h2>
        Wallet Credentials <span className="chip remote">remote</span>
      </h2>
      <p className="hint">
        Credential metadata synced from the connected wallet into the credential store — the
        domain's one source of truth, mirrored by the adapter for the session's lifetime (raw
        payloads and claims never leave the wallet).
      </p>

      {credentials.length === 0 ? (
        <p className="empty">Nothing yet. Connect the Wallet Provider to pull the inventory in.</p>
      ) : (
        <ul className="wallet-list">
          {credentials.map((credential) => (
            <li key={credential.id} className="wallet">
              <div className="wallet-info">
                <span className="wallet-name">
                  {credential.name}
                  {credential.format ? ` · ${credential.format}` : ""}
                </span>
                {credential.issuer && (
                  <span className="wallet-account mono" title={credential.issuer}>
                    {truncate(credential.issuer)}
                  </span>
                )}
                {credential.identityAddress && (
                  <span className="wallet-account mono" title={credential.identityAddress}>
                    holder {truncate(credential.identityAddress)}
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
