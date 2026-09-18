import type { ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { useWallet, WalletManager, WalletProvider } from "@txnlab/use-wallet-react";
import { lute } from "@txnlab/use-wallet-lute";
import { mnemonic } from "@txnlab/use-wallet-mnemonic";
import { pera } from "@txnlab/use-wallet-pera";
import { dappWallet, ProviderAdapter, WALLET_ID } from "./lib/provider/adapter.ts";
import { adoptedExtensions, type KnownExtension } from "./lib/ui/extensions.ts";
import { DomainSection } from "./components/DomainSection.tsx";
import { WalletPanel } from "./components/WalletPanel.tsx";
import { IdentityPanel } from "./components/IdentityPanel.tsx";
import { LocalKeystorePanel } from "./components/LocalKeystorePanel.tsx";
import { WalletEncryptionPanel } from "./components/WalletEncryptionPanel.tsx";
import { WalletPasskeysPanel } from "./components/WalletPasskeysPanel.tsx";
import { WalletCredentialsPanel } from "./components/WalletCredentialsPanel.tsx";
import { PresentationPanel } from "./components/PresentationPanel.tsx";
import { ConnectionPanel } from "./components/ConnectionPanel.tsx";
import { ConnectModal } from "./components/ConnectModal.tsx";
import { keyStore } from "./stores/keyStore.ts";
import { store } from "./stores/walletStore.ts";

/**
 * The wallet connection layer, powered by use-wallet.
 *
 * On-chain interactions (auth, signing, transactions) go through the
 * connected Algorand wallet, while identity presentations go through the
 * platform's Digital Credentials API (see {@link PresentationPanel}):
 * the two seams a verifier dapp composes. The `mnemonic` wallet is a dev-only
 * convenience for local testing.
 *
 * The `dappWallet()` entry is the example dapp connector: the adapter
 * CONSTRUCTS the dapp Provider from its options, carries the instance,
 * and drives its connections engine (see
 * `lib/provider/adapter.ts`): its Connect button starts the Liquid Auth
 * flow, which parks the pending `liquid://` request in the connections
 * store, where the {@link ConnectModal} observes it as a pop-up over the
 * whole page (like the QR modal in Pera's connect library) so the code
 * is scannable regardless of which domains are rendered; the
 * {@link ConnectionPanel} then surfaces the established session.
 *
 * The manager adopts the Provider's shared TanStack store
 * (`options: { store }`), so the accounts state is ONE reactive instance
 * backing both use-wallet and the Provider's accounts store.
 *
 * The demo contrasts two origins of keys and identities:
 *
 * - **Remote**, synced from the connected wallet: the connect handshake
 *   carries the wallet's domain records (identities, passkey and
 *   credential inventory), and the connections engine feeds each slice
 *   into its own DOMAIN store's session-scoped remote mirror for the
 *   session's lifetime; identities into the shared identity store,
 *   passkeys into the passkeys store, credential metadata into the
 *   credential store (presented by the {@link WalletPasskeysPanel} and
 *   {@link WalletCredentialsPanel}). One source of truth per domain: no
 *   panel reads `session.peer.*` off the connections store.
 * - **Local**, minted in THIS browser: the {@link LocalKeystorePanel}
 *   generates keys in the IndexedDB-backed web keystore (an Ed25519
 *   identity key projected as a `did:key` identity).
 *
 * Encryption bridges the two: the {@link WalletEncryptionPanel} derives
 * a shared key from the CONNECTED wallet's identity (its DID document's
 * `keyAgreement` key); no options are shown until a wallet connects,
 * and no self-owned encryption key exists at all.
 *
 * Both kinds of identity live in the ONE identity store as a narrowable
 * union (mirroring the accounts store pattern), and the
 * {@link IdentityPanel} splits them back apart via their
 * `metadata.source` discriminant.
 *
 * The page is organized by DOMAIN (Accounts, Identities, Credentials,
 * Passkeys, Keys, Connections), each {@link DomainSection} naming the
 * packages in use, like the react-native-wallet example's home screen.
 * The PROVIDER determines the render: only the Accounts section (the
 * use-wallet connection surface) is always visible; the extension-backed
 * domains appear only while the Wallet Provider is the ACTIVE wallet, and
 * only for the extensions its Provider instance actually adopted (see
 * {@link ExtensionDomains} and `lib/ui/extensions.ts`).
 */
const walletManager = new WalletManager({
  wallets: [
    // The example dapp connector, a factory like the others: the adapter
    // constructs and carries the provider (plus the auto-resume wiring),
    // so nothing is required; a few provider-level construction options
    // (protocol id, signaling/ICE knobs, metadata override) are available
    // (see lib/provider/adapter.ts).
    dappWallet(),
    pera(),
    lute(),
    mnemonic(),
  ],
  defaultNetwork: "testnet",
  options: { store },
});

/**
 * The provider CONTEXT (`ctx`), with no global instance: the manager
 * constructed the {@link ProviderAdapter} above, and the adapter carries
 * the dapp Provider it built from its options. Every provider-driving
 * flow (and the panels that call them) takes this context as its first
 * parameter.
 */
const ctx = (walletManager.getWallet(WALLET_ID) as ProviderAdapter).provider;

/**
 * What the Wallet Provider has adopted, inferred off the Provider
 * instance itself: extensions install their namespaced APIs in the
 * constructor and never change afterwards, so one probe at module scope
 * is enough (see `lib/ui/extensions.ts`).
 */
const ADOPTED_EXTENSIONS = adoptedExtensions(ctx);

/**
 * An extension-backed domain of the page: rendered only while the Wallet
 * Provider is the active use-wallet wallet AND its Provider instance has
 * adopted the backing extension.
 */
interface ExtensionDomain {
  /** The extension whose adoption reveals this domain. */
  requires: KnownExtension;
  title: string;
  color: string;
  description: string;
  packages: string[];
  panels: ReactNode;
}

const EXTENSION_DOMAINS: ExtensionDomain[] = [
  {
    requires: "WithIdentities",
    title: "Identities",
    color: "#5856d6",
    description:
      "Local did:key identities minted from the browser keystore, plus the ones the connected wallet syncs.",
    packages: ["@algorandfoundation/identities"],
    panels: <IdentityPanel ctx={ctx} />,
  },
  {
    requires: "WithCredentials",
    title: "Credentials",
    color: "#ff9500",
    description:
      "The connected wallet's credential inventory mirrored into the credential store, plus the Digital Credentials API seam.",
    packages: ["@algorandfoundation/credentials"],
    panels: (
      <>
        <WalletCredentialsPanel />
        <PresentationPanel />
      </>
    ),
  },
  {
    requires: "WithPasskeys",
    title: "Passkeys",
    color: "#af52de",
    description:
      "Passkeys held by the connected wallet's credential provider, mirrored into the passkeys store.",
    packages: ["@algorandfoundation/passkeys", "@algorandfoundation/passkeys-core"],
    panels: <WalletPasskeysPanel />,
  },
  {
    requires: "WithKeyStore",
    title: "Keys",
    color: "#007aff",
    description:
      "Keys minted in this browser's WebCrypto + IndexedDB keystore — private material never leaves it.",
    packages: ["@algorandfoundation/keystore"],
    panels: <LocalKeystorePanel ctx={ctx} />,
  },
  {
    requires: "WithConnections",
    title: "Connections",
    color: "#2cd3e1",
    description:
      "Remote wallet connections over the Liquid Auth protocol, plus the encrypted channel they establish.",
    packages: ["@algorandfoundation/connections"],
    panels: (
      <>
        <ConnectionPanel />
        <WalletEncryptionPanel ctx={ctx} />
      </>
    ),
  },
];

/**
 * The provider-determined portion of the page. The extension domains stay
 * hidden until the Wallet Provider is the ACTIVE use-wallet wallet; once
 * it is, only the domains whose backing extension the Provider instance
 * actually adopted are rendered, inferred from the namespaced APIs the
 * extensions installed, not hard-coded (see `lib/ui/extensions.ts`).
 */
function ExtensionDomains() {
  const { activeWallet } = useWallet();

  if (activeWallet?.id !== WALLET_ID) {
    return (
      <section className="card">
        <h2>Wallet Provider extensions</h2>
        <p className="empty">
          Connect and activate the Wallet Provider above to reveal the extension domains it has
          adopted.
        </p>
      </section>
    );
  }

  return (
    <>
      {EXTENSION_DOMAINS.filter((domain) => ADOPTED_EXTENSIONS.has(domain.requires)).map(
        (domain) => (
          <DomainSection
            key={domain.title}
            title={domain.title}
            color={domain.color}
            description={domain.description}
            packages={domain.packages}
          >
            {domain.panels}
          </DomainSection>
        ),
      )}
    </>
  );
}

function App() {
  // The local keystore's operation lifecycle, surfaced as the header
  // status pill, the same signal the web-keystore example renders.
  const status = useStore(keyStore, (state) => state.status);

  return (
    <WalletProvider manager={walletManager}>
      <div className="app">
        <header className="app-header">
          <div className="logo">🪪</div>
          <div>
            <h1>use-wallet Client</h1>
            <p>Verifier dapp demo — wallet connection + Digital Credentials API</p>
          </div>
          <span className="status" data-status={status}>
            {status}
          </span>
        </header>
        <main className="app-main">
          {/* The activation surface stays: connecting/activating the Wallet
              Provider here is what reveals the extension domains below. */}
          <DomainSection
            title="Accounts"
            color="#34c759"
            description="Wallet connections and on-chain accounts via use-wallet."
            packages={["@algorandfoundation/accounts", "@txnlab/use-wallet-react"]}
          >
            <WalletPanel />
          </DomainSection>

          <ExtensionDomains />
        </main>
        {/* The liquid:// QR pop-up is mounted at page level so a pending
            connect can always present its QR, even while the extension
            domains (including the Connections panel) are hidden. */}
        <ConnectModal />
        <footer>
          Powered by{" "}
          <a href="https://github.com/TxnLab/use-wallet" target="_blank" rel="noreferrer">
            @txnlab/use-wallet
          </a>{" "}
          and{" "}
          <a href="https://github.com/algorandfoundation" target="_blank" rel="noreferrer">
            @algorandfoundation
          </a>{" "}
          credentials packages.
        </footer>
      </div>
    </WalletProvider>
  );
}

export default App;
