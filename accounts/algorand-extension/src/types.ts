import type {
  Account,
  AccountStoreOptions,
  AccountStoreState,
  WalletKey,
} from "@algorandfoundation/accounts-core";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { AlgoClientConfig } from "@algorandfoundation/algokit-utils/types/network-client";
import type { KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Subset of the algorand option block shared by extensions that need an
 * algod / indexer connection. Re-used by `WithAlgorandAccounts` and
 * `WithIntermezzoAccount` so a single `algorand: { … }` block on the
 * provider config wires both extensions.
 */
export interface AlgorandProviderOptions {
  /* Genesis ID e.g. testnet-v1.0 */
  network: string;
  algodConfig: AlgoClientConfig;
  /**
   * Optional indexer config. When provided, extensions will lazily build
   * an `algosdk.Indexer` client and attach it to `provider.algorand.indexer`
   * (only if not already set by a previously-loaded extension).
   */
  indexerConfig?: AlgoClientConfig;
  hooks?: HookCollection<any>;
}

/**
 * Shape attached to `provider.algorand` by Algorand-aware extensions.
 * Both clients are built once and shared between extensions so callers
 * (hooks, screens) don't have to re-resolve env config.
 */
export interface AlgorandProviderClients {
  algod: AlgorandClient["client"]["algod"];
  indexer: NonNullable<AlgorandClient["client"]["indexerIfPresent"]> | null;
}

/**
 * Options for the AlgorandAccounts extension.
 */
export interface AlgorandAccountsExtensionOptions
  extends ExtensionOptions, KeyStoreOptions, AccountStoreOptions<Account> {
  algorand: AlgorandProviderOptions;
  accounts: NonNullable<AccountStoreOptions<Account>["accounts"]> & {
    /**
     * The TanStack store instance backing the account state.
     * Required — the extension populates it from the keystore.
     */
    store: Store<AccountStoreState<Account>>;
    /**
     * The wallet key the extension reads and writes under.
     * Defaults to the provider's `id`.
     */
    walletKey?: WalletKey;
  };
}

/**
 * The surface `WithAlgorandAccounts` mounts on the provider: shared,
 * typed algod / indexer clients under `provider.algorand`.
 */
export interface AlgorandAccountsExtension {
  algorand: AlgorandProviderClients;
}

/**
 * Represents an Algorand Account
 */
export interface AlgorandAccount extends Account {
  type: "algorand-account";
  /**
   * Account metadata. Includes the originating key id (and its type) and
   * an optional parent key id.
   */
  metadata?: {
    keyId: string;
    /**
     * The backing key's type (e.g. `"hd-derived-ed25519"`) — lets
     * consumers label the account kind.
     */
    keyType?: string;
    parentKeyId?: string;
    /**
     * The post-quantum address scheme identifier (e.g. `"f1"` for
     * Falcon-1024) when the address is a canonical PQ digest.
     */
    pqScheme?: string;
    /**
     * The canonical salt baked into the PQ address preimage, present
     * alongside {@link pqScheme}.
     */
    pqSalt?: number;
    [key: string]: unknown;
  };
  /**
   * A method to sign a transaction or a set of transactions.
   *
   * @param txns - The transactions to sign.
   * @returns The signed transactions.
   */
  sign: (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}
