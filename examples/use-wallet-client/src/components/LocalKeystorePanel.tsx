import { useState } from "react";
import { useStore } from "@tanstack/react-store";
import { keyStore } from "../stores/keyStore.ts";
import type { DappProvider } from "../lib/provider/provider.ts";
import { generateLocalIdentity } from "../lib/identities/localIdentities.ts";
import { isIdentityKey, isKeyAgreementKey } from "../lib/identities/keys/types.ts";
import { bytesToHex, truncate } from "../lib/ui/format.ts";

/**
 * The LOCAL half of the demo: a browser keystore living entirely in this
 * page (WebCrypto + IndexedDB, metadata mirrored into the reactive
 * `keyStore`). Contrast it with the REMOTE keys/passkeys/identities the
 * connected wallet syncs over the connection pipe.
 *
 * **Generate identity key** mints a fresh Ed25519 signing key plus its
 * X25519 key-agreement companion (WebCrypto limits Ed25519 to
 * `sign`/`verify`, so the ECDH half is its own non-extractable key) and
 * projects the identity as a local `did:key` into the shared identity
 * store (see `IdentityPanel`). Encryption is NOT a local affair anymore:
 * the shared key is derived from the connected wallet's identity against
 * that companion key; see the `WalletEncryptionPanel`.
 *
 * @param ctx - The provider context the connector carries (`adapter.provider`).
 */
export function LocalKeystorePanel({ ctx }: { ctx: DappProvider }) {
  const keys = useStore(keyStore, (state) => state.keys);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>
        Local Keystore <span className="chip local">local</span>
      </h2>
      <p className="hint">
        Keys generated in THIS browser (WebCrypto + IndexedDB) — private material never leaves the
        keystore. Compare with the remote inventory the connected wallet exposes.
      </p>

      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await generateLocalIdentity(ctx);
            })
          }
        >
          {busy ? "Generating…" : "Generate identity key"}
        </button>
      </div>

      {keys.length === 0 ? (
        <p className="empty">No local keys yet — generate an identity key to get started.</p>
      ) : (
        <ul className="wallet-list">
          {keys.map((key) => (
            <li key={key.id} className="wallet">
              <div className="wallet-info">
                <span className="wallet-name">
                  {(key.metadata?.name as string | undefined) ?? key.type}{" "}
                  <span className="chip local">
                    {isIdentityKey(key)
                      ? "identity"
                      : isKeyAgreementKey(key)
                        ? "keyAgreement"
                        : key.type}
                  </span>
                </span>
                <span className="wallet-account">
                  {key.type} · {key.algorithm}
                </span>
                {key.publicKey && (
                  <span className="wallet-account mono" title={bytesToHex(key.publicKey)}>
                    pub {truncate(bytesToHex(key.publicKey))}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="output error">{error}</p>}
    </section>
  );
}
