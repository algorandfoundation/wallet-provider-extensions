import type {
  Account,
  AccountStoreOptions,
  AccountStoreState,
  WalletKey,
} from "@algorandfoundation/accounts-core";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { AlgoClientConfig } from "@algorandfoundation/algokit-utils/types/network-client";
import type { KeyStoreNamespace, KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * The `options.algorand` namespace {@link WithAlgorandAccounts} claims on the
 * shared `ExtensionOptions` registry: the algod / indexer connection
 * every Algorand-aware extension needs. This package owns the registration;
 * other Algorand-aware extensions read the same block and **augment** this
 * interface when they need extra fields, so a single `algorand: { … }` block
 * on the provider config wires all of them.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider(
 *   { id: "my-provider", name: "My Provider" },
 *   {
 *     accounts: { store: accountStore },
 *     keystore: { store: keyStore },
 *     algorand: {
 *       network: "testnet-v1.0",
 *       algodConfig: { server: "https://testnet-api.algonode.cloud", port: 443, token: "" },
 *     },
 *   },
 * );
 * ```
 */
export interface AlgorandNamespace {
  /** Genesis ID e.g. `testnet-v1.0`. */
  network: string;
  /** The algod connection config the shared `AlgorandClient` is built from. */
  algodConfig: AlgoClientConfig;
  /**
   * Optional indexer config. When provided, extensions will lazily build
   * an `algosdk.Indexer` client and attach it to `provider.algorand.indexer`
   * (only if not already set by a previously-loaded extension).
   */
  indexerConfig?: AlgoClientConfig;
  /**
   * Hooks for intercepting Algorand account operations (currently `"sign"`).
   * A fresh collection is created when omitted.
   */
  hooks?: HookCollection<any>;
}

/**
 * Subset of the algorand option block shared by extensions that need an
 * algod / indexer connection.
 *
 * @deprecated Use {@link AlgorandNamespace}; kept as an alias for one release.
 */
export type AlgorandProviderOptions = AlgorandNamespace;

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Algorand connection settings shared by Algorand-aware extensions, see {@link AlgorandNamespace}. */
    algorand?: AlgorandNamespace;
  }
}

/**
 * Shape attached to `provider.algorand` by Algorand-aware extensions.
 * Both clients are built once and shared between extensions so callers
 * (hooks, screens) don't have to re-resolve env config.
 *
 * @example
 * ```typescript
 * const info = await provider.algorand.algod.accountInformation(address).do();
 * const txns = await provider.algorand.indexer?.searchForTransactions().address(address).do();
 * ```
 */
export interface AlgorandProviderClients {
  /** The shared algod client. */
  algod: AlgorandClient["client"]["algod"];
  /** The shared indexer client, or `null` when no `indexerConfig` was supplied. */
  indexer: NonNullable<AlgorandClient["client"]["indexerIfPresent"]> | null;
}

/**
 * Options for the AlgorandAccounts extension.
 *
 * Narrows the shared registry: `options.algorand`, `options.keystore` and
 * `options.accounts.store` are **required** when the bridge is mounted.
 *
 * @example
 * ```typescript
 * const options: AlgorandAccountsExtensionOptions = {
 *   accounts: { store: accountStore },
 *   keystore: { store: keyStore, hooks: keyStoreHooks },
 *   algorand: { network: "testnet-v1.0", algodConfig },
 * };
 * ```
 */
export interface AlgorandAccountsExtensionOptions
  extends KeyStoreOptions, AccountStoreOptions<Account> {
  /** Algorand connection settings, see {@link AlgorandNamespace}. */
  algorand: AlgorandNamespace;
  /** Accounts-specific settings; the shared store is required. */
  accounts: NonNullable<AccountStoreOptions<Account>["accounts"]> & {
    /**
     * The TanStack store instance backing the account state.
     * Required; the extension populates it from the keystore.
     */
    store: Store<AccountStoreState<Account>>;
    /**
     * The wallet key the extension reads and writes under.
     * Defaults to the provider's `id`.
     */
    walletKey?: WalletKey;
  };
  /** Keystore-specific settings; the keystore's reactive store is required. */
  keystore: KeyStoreNamespace;
}

/**
 * The surface `WithAlgorandAccounts` mounts on the provider: shared,
 * typed algod / indexer clients under `provider.algorand`.
 *
 * @example
 * ```typescript
 * const status = await provider.algorand.algod.status().do();
 * ```
 */
export interface AlgorandAccountsExtension {
  /** Shared algod / indexer clients, see {@link AlgorandProviderClients}. */
  algorand: AlgorandProviderClients;
}

/**
 * Represents an Algorand Account: a keystore-backed account with a concrete
 * Algorand address, live balance / assets and a keystore-routed `sign`.
 *
 * @example
 * ```typescript
 * const account = provider.accounts.find(isAlgorandAccount);
 * if (account) {
 *   console.log(account.address, account.balance);
 *   const signed = await account.sign([txnBytes]);
 * }
 * ```
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
     * The backing key's type (e.g. `"hd-derived-ed25519"`); lets
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
