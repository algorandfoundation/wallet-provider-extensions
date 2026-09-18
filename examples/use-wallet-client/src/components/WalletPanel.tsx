import { useState } from "react";
import { useWallet, type Wallet } from "@txnlab/use-wallet-react";
import { accountKind } from "../lib/ui/accountKinds.ts";

/**
 * The use-wallet connection panel: connects / disconnects wallets and lists
 * every account of every CONNECTED wallet, highlighting the active one.
 * Accounts that carry type information from the connect handshake (see
 * `accountKinds.ts`) are badged with a friendly kind name: HD vs Ed25519
 * vs post-quantum Falcon vs Watched.
 * Once a connection is established the wallet picker collapses into a
 * compact summary ("Change wallets" re-expands it) so the accounts take
 * the stage. This is the piece that will keep aligning with use-wallet as
 * its account primitives formalize; the credential presentation flow next
 * to it is wallet-agnostic.
 */
export function WalletPanel() {
  const { availableWallets } = useWallet();
  const [connecting, setConnecting] = useState<string | null>(null);
  // Manual re-expansion of the wallet picker after a connection collapsed it.
  const [showWallets, setShowWallets] = useState(false);

  const connectedWallets = availableWallets.filter((wallet) => wallet.isConnected);
  const hasConnection = connectedWallets.length > 0;
  const walletsVisible = !hasConnection || showWallets;

  const handleConnect = async (wallet: Wallet) => {
    try {
      setConnecting(wallet.id);
      await wallet.connect();
      // Collapse the picker once the connection is established.
      setShowWallets(false);
    } catch (error) {
      console.error(`Failed to connect ${wallet.metadata.name}:`, error);
    } finally {
      // No QR cleanup needed: the ConnectModal observes the connections
      // store, and the attempt settling flips the session out of its
      // peerless waiting state (see ../lib/ui/pendingRequest.ts).
      setConnecting(null);
    }
  };

  /** Makes the given account (and its wallet) the active one. */
  const handleActivate = (wallet: Wallet, address: string) => {
    wallet.setActiveAccount(address);
    if (!wallet.isActive) wallet.setActive();
  };

  return (
    <section className="card">
      <h2>Wallet Connection</h2>
      <p className="hint">
        Connect an Algorand wallet with <code>use-wallet</code> for on-chain interactions
        (authentication, signing, transactions).
      </p>

      {walletsVisible ? (
        <>
          <ul className="wallet-list">
            {availableWallets.map((wallet) => (
              <li key={wallet.walletKey} className={wallet.isActive ? "wallet active" : "wallet"}>
                <img
                  src={wallet.metadata.icon}
                  alt={wallet.metadata.name}
                  className="wallet-icon"
                />
                <div className="wallet-info">
                  <span className="wallet-name">{wallet.metadata.name}</span>
                  {wallet.isConnected && (
                    <span className="wallet-account mono">
                      {wallet.accounts.length} account{wallet.accounts.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="wallet-actions">
                  {wallet.isConnected ? (
                    <>
                      {!wallet.isActive && (
                        <button className="small" onClick={() => wallet.setActive()}>
                          Activate
                        </button>
                      )}
                      <button className="small danger" onClick={() => wallet.disconnect()}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="small primary"
                      onClick={() => handleConnect(wallet)}
                      disabled={connecting === wallet.id}
                    >
                      {connecting === wallet.id ? "Connecting…" : "Connect"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasConnection && (
            <div className="actions wallet-list-toggle">
              <button className="small ghost" onClick={() => setShowWallets(false)}>
                Hide wallets
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="connection-summary">
          <div className="connection-wallets">
            {connectedWallets.map((wallet) => (
              <span key={wallet.walletKey} className="connection-wallet">
                <img src={wallet.metadata.icon} alt="" />
                {wallet.metadata.name}
              </span>
            ))}
          </div>
          <button className="small ghost" onClick={() => setShowWallets(true)}>
            Change wallets
          </button>
        </div>
      )}

      <h3>Connected accounts</h3>
      {hasConnection ? (
        <ul className="account-list">
          {connectedWallets.flatMap((wallet) =>
            wallet.accounts.map((account) => {
              const isActive = wallet.isActive && account.address === wallet.activeAccount?.address;
              const kind = accountKind(account);
              return (
                <li
                  key={`${wallet.walletKey}:${account.address}`}
                  className={isActive ? "account active" : "account"}
                >
                  <div className="account-info">
                    <span className="account-name">
                      {account.name}
                      {kind && (
                        <span className={`chip account-kind ${kind.chip}`}>{kind.label}</span>
                      )}
                    </span>
                    <span className="mono">{account.address}</span>
                  </div>
                  <span className="account-wallet">{wallet.metadata.name}</span>
                  {isActive ? (
                    <span className="chip supported">Active</span>
                  ) : (
                    <button
                      className="small"
                      onClick={() => handleActivate(wallet, account.address)}
                    >
                      Use
                    </button>
                  )}
                </li>
              );
            }),
          )}
        </ul>
      ) : (
        <p className="empty">No wallet connected yet.</p>
      )}
    </section>
  );
}
