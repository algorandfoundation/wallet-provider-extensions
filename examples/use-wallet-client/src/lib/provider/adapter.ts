/**
 * The EXAMPLE DAPP CONNECTOR: a use-wallet v5 adapter over the dapp's
 * Algorand Wallet Provider. Lives in this example (formerly
 * `@algorandfoundation/use-wallet-provider`); copy it into your dapp
 * and adjust as needed.
 *
 * The adapter OWNS the provider: it CONSTRUCTS the instance from its
 * adapter options (`createProvider`, see `./provider.ts`) and carries it
 * as {@link ProviderAdapter.provider}; there is no global provider
 * instance; flows that drive the provider take it as their first
 * parameter (`ctx`). The wallet entry
 * is the {@link dappWallet} factory, shaped like every other use-wallet
 * factory (`pera()`, `lute()`, …): call it with no arguments, or pass
 * the few provider-level construction options it exposes (the connection
 * protocol connects route through, the signaling/ICE knobs, a metadata
 * override).
 *
 * `connect()` routes through `provider.connection.connect(protocolId)`
 * (liquid-auth by default, the `liquid://` QR flow the provider
 * registered), and `signTransactions()` travels the connection RPC as
 * base64 msgpack per the `sign_transactions` wire shape of
 * `@algorandfoundation/connections-core`.
 *
 * The connect handshake also carries the wallet's DOMAIN records:
 * accounts, identities, passkey and credential metadata, keyed by
 * domain id on `session.peer.domains`. The adapter mirrors NOTHING
 * itself: the connections engine infers the domains from the mounted
 * store extensions and feeds each store's session-scoped `remote`
 * mirror automatically (received on connect, revoked on disconnect).
 * One source of truth per domain: the panels read the domain stores,
 * never the connections store.
 *
 * Sessions survive reloads: `resumeSession()` adopts the persisted
 * session optimistically (accounts render immediately, the persisted
 * peer records are re-fed into the domain mirrors) and re-establishes
 * the transport in the background via `connection.resume()`; the wallet
 * re-offers on presence, no QR or passkey involved.
 */

import algosdk from "algosdk";
import {
  BaseWallet,
  base64ToByteArray,
  byteArrayToBase64,
  flattenTxnGroup,
  isSignedTxn,
  isTransactionArray,
  type AdapterConstructorParams,
  type WalletAdapterConfig,
  type WalletFactoryOptions,
  type WalletMetadata,
  type WalletState,
  type WalletTransaction,
} from "@txnlab/use-wallet/adapter";
import { createDomainRegistry, discoverDomains } from "@algorandfoundation/connections";
import type { ConnectionSession } from "@algorandfoundation/connections";
import type { Account } from "@algorandfoundation/accounts";
import type { ProviderWalletAccount } from "../accounts/types.ts";
import { createProvider, type DappProvider, type DappProviderOptions } from "./provider.ts";
import { store as walletStore } from "../../stores/walletStore.ts";
import { connectionsStore } from "../../stores/connectionsStore.ts";
import { installAutoResume, kickResume, suspendAutoResume } from "../connections/autoResume.ts";
import { rehydrateLocalIdentities } from "../identities/localIdentities.ts";

const ICON = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#001324"/><path d="M9 22 16 9l7 13h-3.2l-1.4-2.7h-2.9L17 16.5h1L16 12.6 11.9 22Z" fill="#2cd3e1"/></svg>`,
)}`;

/** The wallet id the connector registers under. */
export const WALLET_ID = "wallet-provider" as const;

/** The default connection protocol connects route through (see `./provider.ts`). */
const DEFAULT_PROTOCOL_ID = "liquid-auth";

/**
 * The provider-level options {@link dappWallet} passes to the adapter's
 * construction: the {@link DappProviderOptions} construction knobs the
 * adapter hands to `createProvider`, plus the protocol connects route
 * through. Knobs, not injection seams.
 */
export interface DappWalletOptions extends DappProviderOptions {
  /**
   * The connection protocol `connect()` routes through, one the
   * provider registered (see `./provider.ts`). Defaults to liquid-auth,
   * the `liquid://` QR flow.
   */
  protocolId?: string;
}

export class ProviderAdapter extends BaseWallet<DappWalletOptions, ProviderWalletAccount> {
  /**
   * The dapp Provider this adapter carries, constructed from the
   * adapter options, so the dapp configures the provider through
   * `dappWallet(options)`. The context (`ctx`) every provider-driving
   * flow takes as its first parameter.
   */
  public readonly provider: DappProvider;

  /** The live connection session backing this wallet, when connected. */
  private sessionId: string | null = null;

  // BaseWallet's constructor is protected; re-expose it publicly so the
  // manager can instantiate the adapter from the factory's config below.
  constructor(params: AdapterConstructorParams<DappWalletOptions, ProviderWalletAccount>) {
    super(params);

    // The adapter owns its provider: construct it from the adapter
    // options and wire the app's auto-resume watcher to its connection.
    this.provider = createProvider(this.options);
    installAutoResume(this.provider.connection, connectionsStore);

    // Kick the initial page-load resume (browser-only): persisted
    // sessions hydrate as `disconnected` (transports never survive a
    // reload), so park the one carrying the wallet's accounts on the
    // signaling rendezvous right away. Guarded by the persisted
    // use-wallet state (a manual disconnect removed it, so there is nothing to
    // resume then). `resumeSession()` shares this attempt
    // (single-flight); retries after signaling failures come from the
    // auto-resume backoff loop.
    if (typeof window !== "undefined") {
      void this.provider.connection.ready.then(async () => {
        if (!walletStore.state.wallets[WALLET_ID]) return;
        const sessions = await this.provider.connection.store.getSessions();
        const session = sessions.find((s) => (s.peer?.domains?.accounts?.length ?? 0) > 0);
        if (session && session.status !== "connected") kickResume(session.id);
      });
    }

    // Kick the page-load identity rehydration (fire-and-forget): the
    // keystore's keys persist in IndexedDB, so the local identities they
    // back should reappear without any user action. Browser-only: under
    // Node (vitest) there is no IndexedDB for the keystore's `ready` to
    // hydrate from (see ../identities/localIdentities.ts).
    if (typeof indexedDB !== "undefined") {
      void rehydrateLocalIdentities(this.provider).catch((error) => {
        console.error("Failed to rehydrate the local identities:", error);
      });
    }
  }

  static defaultMetadata: WalletMetadata = {
    name: "Wallet Provider",
    icon: ICON,
  };

  private get connection() {
    return this.provider.connection;
  }

  private get protocolId(): string {
    return this.options.protocolId ?? DEFAULT_PROTOCOL_ID;
  }

  /**
   * Maps the session's peer accounts (the `accounts` domain of the
   * connect handshake) to use-wallet accounts. The account `type` and
   * `metadata` the wallet transmitted travel through verbatim so the
   * dapp can tell the account kinds apart.
   */
  private toWalletAccounts(session: ConnectionSession): ProviderWalletAccount[] {
    const accounts = (session.peer?.domains?.accounts ?? []) as (Account & { type?: string })[];
    return accounts.map((account, index) => ({
      name: account.name ?? `${this.metadata.name} Account ${index + 1}`,
      address: account.address,
      ...(account.type ? { type: account.type } : {}),
      ...(account.metadata ? { metadata: account.metadata } : {}),
    }));
  }

  /**
   * Re-feeds a PERSISTED session's peer records into the domain stores'
   * mirrors, the optimistic half of {@link resumeSession}. Live
   * handshakes need none of this: the connections engine receives (and
   * revokes) the domain records itself; this only replays what the
   * persisted session carries so the panels render before the transport
   * re-establishes (the background resume then refreshes the mirrors
   * with a session-routed signer attached).
   */
  private async adoptPeerDomains(session: ConnectionSession): Promise<void> {
    try {
      await createDomainRegistry(discoverDomains(this.provider)).receive(
        session.id,
        session.peer?.domains ?? {},
      );
    } catch (error: any) {
      this.logger.warn("Failed to re-feed the persisted peer records:", error?.message ?? error);
    }
  }

  public connect = async (args?: Record<string, any>): Promise<ProviderWalletAccount[]> => {
    this.logger.info(`Connecting via protocol ${this.protocolId}...`);
    // Guarantee the domain bridges (the session-scoped remote mirrors the
    // metas auto-load) are mounted before the handshake, so the dapp's
    // local records travel the first exchange instead of the domains
    // degrading to announce-only.
    await Promise.all([
      this.provider.account.store.ready,
      this.provider.identity.store.ready,
      this.provider.passkey.store.ready,
      this.provider.credential.store.ready,
    ]);
    const session = await this.connection.connect(this.protocolId, {
      signal: args?.signal as AbortSignal | undefined,
      // No onFallback bridge: the requester parks the out-of-band request
      // as a peerless pending session in the connections store, and the
      // page-level ConnectModal observes the store to pop the liquid://
      // QR (see ../ui/pendingRequest.ts).
    });

    const walletAccounts = this.toWalletAccounts(session);
    if (walletAccounts.length === 0) {
      this.logger.error("The wallet exposed no accounts");
      await this.connection.disconnect(session.id);
      throw new Error("The wallet exposed no accounts");
    }

    this.sessionId = session.id;
    const walletState: WalletState<ProviderWalletAccount> = {
      accounts: walletAccounts,
      activeAccount: walletAccounts[0],
    };
    this.store.addWallet(walletState);

    // Nothing else to mirror by hand: the connections engine already fed
    // the wallet's domain records (identities, passkeys, credentials)
    // into the domain stores' remote mirrors during the handshake.

    this.logger.info("Connected successfully", walletState);
    return walletAccounts;
  };

  public disconnect = async (): Promise<void> => {
    this.logger.info("Disconnecting...");
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (sessionId) {
      // Tell auto-resume this drop is intentional before the status flips
      // (see ../connections/autoResume.ts).
      suspendAutoResume(sessionId);
      try {
        // The engine revokes the session's domain mirrors on disconnect.
        await this.connection.disconnect(sessionId);
      } catch (error: any) {
        this.logger.warn("Failed to close the connection cleanly:", error.message);
      }
    }
    this.onDisconnect();
    this.logger.info("Disconnected");
  };

  public resumeSession = async (): Promise<void> => {
    const walletState = this.store.getWalletState();

    // No session to resume.
    if (!walletState) {
      this.logger.info("No session to resume");
      return;
    }

    this.logger.info("Resuming session...");
    await this.connection.ready;
    const sessions = await this.connection.store.getSessions();
    // At most one wallet session exists in this example; prefer the one
    // carrying the wallet's accounts from the connect handshake.
    const session =
      sessions.find((s) => (s.peer?.domains?.accounts?.length ?? 0) > 0) ?? sessions[0];
    if (!session) {
      this.logger.warn("No persisted session to resume; disconnecting");
      this.onDisconnect();
      return;
    }

    // Adopt the persisted session OPTIMISTICALLY (like WalletConnect
    // pairings): keep the persisted wallet state so the accounts render
    // immediately, and replay the persisted peer records into the domain
    // stores' mirrors. Signing works as soon as the transport
    // re-establishes below; a signTransactions before that fails with the
    // engine's "no live connection" error.
    this.sessionId = session.id;
    await this.adoptPeerDomains(session);
    this.logger.info("Session adopted", { sessionId: session.id, status: session.status });

    // Re-establish the transport in the BACKGROUND: park on the session's
    // signaling rendezvous until the wallet re-offers (fire-and-forget;
    // the UI is already usable). The resume re-runs the connect handshake,
    // and the engine refreshes the domain mirrors with the possibly
    // updated records (session-routed signer attached) when it completes.
    if (session.status !== "connected") {
      this.connection
        .resume(session.id)
        .then((resumed) => {
          this.logger.info("Session resumed", { sessionId: resumed.id });
        })
        .catch((error: any) => {
          this.logger.warn("Background resume failed:", error?.message ?? error);
        });
    }
  };

  private processTxns(
    txnGroup: algosdk.Transaction[],
    indexesToSign?: number[],
  ): WalletTransaction[] {
    const txnsToSign: WalletTransaction[] = [];

    txnGroup.forEach((txn, index) => {
      const isIndexMatch = !indexesToSign || indexesToSign.includes(index);
      const signer = txn.sender.toString();
      const canSignTxn = this.addresses.includes(signer);

      const txnString = byteArrayToBase64(txn.toByte());

      if (isIndexMatch && canSignTxn) {
        txnsToSign.push({ txn: txnString });
      } else {
        txnsToSign.push({ txn: txnString, signers: [] });
      }
    });

    return txnsToSign;
  }

  private processEncodedTxns(
    txnGroup: Uint8Array[],
    indexesToSign?: number[],
  ): WalletTransaction[] {
    const txnsToSign: WalletTransaction[] = [];

    txnGroup.forEach((txnBuffer, index) => {
      const decodedObj = algosdk.msgpackRawDecode(txnBuffer);
      const isSigned = isSignedTxn(decodedObj);

      const txn: algosdk.Transaction = isSigned
        ? algosdk.decodeSignedTransaction(txnBuffer).txn
        : algosdk.decodeUnsignedTransaction(txnBuffer);

      const isIndexMatch = !indexesToSign || indexesToSign.includes(index);
      const signer = txn.sender.toString();
      const canSignTxn = !isSigned && this.addresses.includes(signer);

      const txnString = byteArrayToBase64(txn.toByte());

      if (isIndexMatch && canSignTxn) {
        txnsToSign.push({ txn: txnString });
      } else {
        txnsToSign.push({ txn: txnString, signers: [] });
      }
    });

    return txnsToSign;
  }

  public signTransactions = async <T extends algosdk.Transaction[] | Uint8Array[]>(
    txnGroup: T | T[],
    indexesToSign?: number[],
  ): Promise<(Uint8Array | null)[]> => {
    try {
      this.logger.debug("Signing transactions...", { txnGroup, indexesToSign });
      const sessionId = this.sessionId;
      if (!sessionId) {
        throw new Error("No active connection session; connect first");
      }

      // Determine type and process transactions for signing.
      let txnsToSign: WalletTransaction[] = [];
      if (isTransactionArray(txnGroup)) {
        const flatTxns: algosdk.Transaction[] = flattenTxnGroup(txnGroup);
        txnsToSign = this.processTxns(flatTxns, indexesToSign);
      } else {
        const flatTxns: Uint8Array[] = flattenTxnGroup(txnGroup as Uint8Array[]);
        txnsToSign = this.processEncodedTxns(flatTxns, indexesToSign);
      }

      // Convert to the connection RPC wire shape: the full group as
      // base64 msgpack plus the positions the wallet should sign.
      const txns = txnsToSign.map((entry) => entry.txn);
      const walletIndexes = txnsToSign.reduce<number[]>((acc, entry, index) => {
        if (!entry.signers) acc.push(index);
        return acc;
      }, []);

      this.logger.debug("Sending processed transactions to wallet...", txnsToSign);
      const stxns = await this.connection.signTransactions(sessionId, txns, walletIndexes);
      this.logger.debug("Received signed transactions from wallet", stxns);

      const result = stxns.map((value) => (value === null ? null : base64ToByteArray(value)));

      this.logger.debug("Transactions signed successfully", result);
      return result;
    } catch (error: any) {
      this.logger.error("Error signing transactions:", error.message);
      throw error;
    }
  };
}

/**
 * The Wallet Provider factory for use-wallet's `wallets: [...]` array;
 * call it with no arguments like the other wallet factories (`pera()`,
 * `lute()`, …). The adapter constructs and carries the provider, so the
 * options are the provider-level construction knobs
 * ({@link DappWalletOptions}) plus the standard metadata override every
 * factory accepts. Typed over {@link ProviderWalletAccount} so the
 * account `type` and `metadata` the wallet transmitted flow through to
 * `useWallet()` consumers.
 */
export function dappWallet(
  options?: DappWalletOptions & WalletFactoryOptions,
): WalletAdapterConfig<ProviderWalletAccount> {
  const { metadata, ...adapterOptions } = options ?? {};
  return {
    id: WALLET_ID,
    metadata: { ...ProviderAdapter.defaultMetadata, ...metadata },
    Adapter: ProviderAdapter as unknown as WalletAdapterConfig<ProviderWalletAccount>["Adapter"],
    options:
      Object.keys(adapterOptions).length > 0
        ? (adapterOptions as unknown as Record<string, unknown>)
        : undefined,
  };
}
