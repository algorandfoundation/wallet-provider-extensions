import { useStore } from "@tanstack/react-store";
import { identityStore } from "../stores/identityStore.ts";
import {
  isLocalIdentity,
  isRemoteIdentity,
  type DappIdentity,
  type LocalIdentity,
  type RemoteIdentity,
} from "../lib/identities/types.ts";
import { removeLocalIdentity } from "../lib/identities/localIdentities.ts";
import type { DappProvider } from "../lib/provider/provider.ts";
import { truncate } from "../lib/ui/format.ts";

/** One identity row, shared by the local and remote sections. */
function IdentityRow({
  identity,
  children,
}: {
  identity: DappIdentity;
  children?: React.ReactNode;
}) {
  return (
    <li className="wallet">
      <div className="wallet-info">
        <span className="wallet-name">{identity.type}</span>
        <span className="wallet-account mono" title={identity.did ?? identity.address}>
          {truncate(identity.did ?? identity.address)}
        </span>
        {identity.didDocument && (
          <span className="wallet-account">
            DID document · {identity.didDocument.verificationMethod?.length ?? 0} verification
            method(s)
          </span>
        )}
      </div>
      {children}
    </li>
  );
}

/**
 * All identities the dapp knows about, from the ONE identity store:
 * a narrowable union, mirroring the accounts store pattern.
 *
 * - **Local** ({@link LocalIdentity}): minted from the browser keystore
 *   (see `LocalKeystorePanel`); the `did:key` signing key lives in this
 *   page's IndexedDB-backed WebCrypto storage.
 * - **Remote** ({@link RemoteIdentity}): synced from the connected wallet
 *   over the connect handshake and recorded by the adapter for the
 *   session's lifetime, removed again on disconnect.
 *
 * The `metadata.source` discriminant narrows the union back into its
 * concrete types for the two sections below.
 *
 * @param ctx - The provider context the connector carries (`adapter.provider`).
 */
export function IdentityPanel({ ctx }: { ctx: DappProvider }) {
  const identities = useStore(identityStore, (state) => state.identities);

  const local: LocalIdentity[] = identities.filter(isLocalIdentity);
  const remote: RemoteIdentity[] = identities.filter(isRemoteIdentity);

  return (
    <section className="card">
      <h2>Identities</h2>
      <p className="hint">
        One store, two origins: identities minted from the local browser keystore next to the ones
        the connected wallet synced over the connection pipe.
      </p>

      <h3>
        Local <span className="chip local">browser keystore</span>
      </h3>
      {local.length === 0 ? (
        <p className="empty">
          None yet — use <strong>Generate identity key</strong> in the Local Keystore panel.
        </p>
      ) : (
        <ul className="wallet-list">
          {local.map((identity) => (
            <IdentityRow key={identity.address} identity={identity}>
              <div className="wallet-actions">
                <button
                  className="small danger"
                  onClick={() => {
                    removeLocalIdentity(ctx, identity).catch((error) => {
                      console.error("Failed to remove the local identity:", error);
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            </IdentityRow>
          ))}
        </ul>
      )}

      <h3>
        Remote <span className="chip remote">connected wallet</span>
      </h3>
      {remote.length === 0 ? (
        <p className="empty">
          No wallet identities yet. Connect the Wallet Provider to pull them in.
        </p>
      ) : (
        <ul className="wallet-list">
          {remote.map((identity) => (
            <IdentityRow key={identity.address} identity={identity} />
          ))}
        </ul>
      )}
    </section>
  );
}
