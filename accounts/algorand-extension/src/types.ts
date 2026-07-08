import type {
  Account,
  AccountStoreOptions,
  AccountStoreState,
} from "@algorandfoundation/accounts-store";
import type { AlgoClientConfig } from "@algorandfoundation/algokit-utils/types/network-client";
import type { KeyStoreOptions } from "@algorandfoundation/keystore";
import type { Extension, ExtensionOptions } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import type algosdk from "algosdk";
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
  algod: algosdk.Algodv2;
  indexer: algosdk.Indexer | null;
}

export interface AlgorandAccountsExtensionOptions
  extends ExtensionOptions, KeyStoreOptions, AccountStoreOptions<Account> {
  algorand: AlgorandProviderOptions;
  accounts: {
    store: Store<AccountStoreState<Account>>;
    hooks: HookCollection<any>;
  };
}

export type AlgorandAccountsExtension = Extension;

/**
 * Represents an Algorand Account
 */
export interface AlgorandAccount extends Account {
  type: "algorand-account";
  /**
   * A method to sign a transaction or a set of transactions.
   *
   * @param txns - The transactions to sign.
   * @returns The signed transactions.
   */
  sign: (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}
