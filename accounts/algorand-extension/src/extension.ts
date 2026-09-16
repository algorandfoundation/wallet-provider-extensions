import {
  type Account,
  type AccountAsset,
  type AccountStoreExtension,
  type AccountStoreState,
  type WalletKey,
  addAccount,
  removeAccount,
} from "@algorandfoundation/accounts-core";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type {
  Key,
  KeyStoreExtension,
  KeyStoreState,
  XHDDerivedKeyData,
} from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import type { LogStoreApi, LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type {
  AlgorandAccount,
  AlgorandAccountsExtension,
  AlgorandAccountsExtensionOptions,
  AlgorandProviderClients,
} from "./types.ts";
import { createSubscriberWithWatchlist, getAlgorandBalances } from "./algorand.ts";
import { algorandAddressForKey } from "./address.ts";

export function isAlgorandAccount(account: Account): account is AlgorandAccount {
  return account.type === "algorand-account";
}

/**
 * Extension that turns keystore keys into concrete Algorand accounts.
 *
 * It subscribes to the keystore, derives canonical Algorand addresses for
 * compatible keys, seeds balances / assets from algod and keeps them in
 * sync through a contained algokit-subscriber watchlist.
 */
export const WithAlgorandAccounts: Extension<AlgorandAccountsExtension> = (
  provider: KeyStoreExtension &
    AccountStoreExtension<Account> &
    LogStoreExtension & { id?: string; algorand?: AlgorandProviderClients },
  options: AlgorandAccountsExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.account) {
    throw new Error(
      "AlgorandAccounts extension requires WithAccounts extension to be present on the provider.",
    );
  }
  if (!provider.key) {
    throw new Error(
      "AlgorandAccounts extension requires WithKeyStore extension to be present on the provider.",
    );
  }

  const log: LogStoreApi | undefined = provider.log;

  // Create algorand client. Pass both algod and (optional) indexer
  // configs so downstream consumers can reach either via
  // `provider.algorand`.
  const algorandClient = AlgorandClient.fromConfig({
    algodConfig: options.algorand.algodConfig,
    indexerConfig: options.algorand.indexerConfig,
  });

  // Typed algod / indexer clients for `provider.algorand` (reused when a
  // previously-loaded Algorand-aware extension already attached them).
  // This lets hooks / screens reuse a single client pair instead of
  // building their own from env config.
  const clients: AlgorandProviderClients = provider.algorand ?? {
    algod: algorandClient.client.algod,
    indexer: algorandClient.client.indexerIfPresent ?? null,
  };

  const accountsStore: Store<AccountStoreState<Account>> = options.accounts.store;
  const keyStore: Store<KeyStoreState> = options.keystore.store;
  // Get or create hooks for algorand account operations
  const hooks = options.algorand.hooks ?? new Hook.Collection<any>();

  // Accounts are written under a wallet key, mirroring use-wallet's
  // per-wallet partitioning. Defaults to the provider's id — the same key
  // WithAccounts scopes to.
  const walletKey: WalletKey | undefined = options.accounts.walletKey ?? provider.id;
  if (!walletKey) {
    throw new Error(
      "AlgorandAccounts extension requires a wallet key (options.accounts.walletKey or provider.id).",
    );
  }

  const storedAccounts = (): Account[] => accountsStore.state.wallets[walletKey]?.accounts ?? [];

  // clone of keystore at starting point prior to execution
  const keys = [...((keyStore.state.keys as Key[]) ?? [])];

  let isProcessing = false;
  let nextKeys: Key[] | null = null;
  let containedSubscriber: ReturnType<typeof createSubscriberWithWatchlist> | null = null;

  const stopContainedSubscriber = (reason: string) => {
    if (!containedSubscriber) return;
    containedSubscriber.stop(reason);
    containedSubscriber = null;
  };

  /**
   * Synthesizes a display name for a key-derived account: the key's
   * `metadata.label` when present, otherwise a truncated address.
   */
  const synthesizeName = (key: Key, address: string): string => {
    const label = (key as { metadata?: { label?: unknown } })?.metadata?.label;
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  };

  const processUpdates = async (newKeys: Key[]) => {
    if (isProcessing) {
      nextKeys = newKeys;
      return;
    }

    log?.info(`[AlgorandAccounts] processUpdates called with ${newKeys.length} keys.`);

    isProcessing = true;
    nextKeys = null;

    // Find added keys
    const addedKeys = newKeys.filter(
      (newKey) => !keys.some((existingKey) => existingKey.id === newKey.id),
    );

    // Find removed keys
    const removedKeys = keys.filter(
      (existingKey) => !newKeys.some((newKey) => newKey.id === existingKey.id),
    );

    if (addedKeys.length === 0 && removedKeys.length === 0) {
      log?.info("[AlgorandAccounts] No changes to process");
      isProcessing = false;

      return;
    }

    // Update the local cache of keys
    keys.length = 0;
    newKeys.forEach((k) => keys.push(k));

    // Remove algorand accounts for removed keys
    await Promise.all(
      removedKeys.map(async (k) => {
        const encoded = algorandAddressForKey(k);
        if (!encoded) return;
        const account = storedAccounts().find((a) => a.address === encoded.address);
        if (account && account.metadata?.keyId === k.id && isAlgorandAccount(account)) {
          log?.info(`Removing algorand account for key ${k.id}-${k.type}...`);
          removeAccount({ store: accountsStore, walletKey, address: encoded.address });
        }
      }),
    );

    // Add algorand accounts for added keys
    await Promise.all(
      addedKeys.map(async (k) => {
        const encoded = algorandAddressForKey(k);
        if (!encoded) return;
        const algorandAddress = encoded.address;

        log?.info(
          `Checking algorand account balances for key ${k.id}-${k.type}... ${algorandAddress}`,
        );

        let r: { balance: bigint; assets?: AccountAsset[] };

        // lookup accounts balances, assets
        try {
          r = await getAlgorandBalances(algorandClient, algorandAddress);
        } catch (error) {
          log?.error("Failed to fetch algorand balances for address:", {
            algorandAddress,
            error,
          });
          return;
        }

        const { balance, assets } = r;

        // Skip if the account already exists
        if (!storedAccounts().some((a) => a.address === algorandAddress && isAlgorandAccount(a))) {
          log?.info(`Adding account for key ${k.id}-${k.type}...`);

          const parentKeyId = (k as XHDDerivedKeyData)?.metadata?.parentKeyId;

          // Create a hooked sign function for this key
          const makeHookedSignFn = (keyId: string) => async (txns: Uint8Array[]) => {
            return hooks(
              "sign",
              async ({ keyId, txns }: { keyId: string; txns: Uint8Array[] }) => {
                const signedTxns: Uint8Array[] = [];
                for (const txn of txns) {
                  const signed = await provider.key.store.sign(keyId, txn);
                  signedTxns.push(signed);
                }
                return signedTxns;
              },
              { keyId, txns },
            );
          };

          const account: AlgorandAccount = {
            type: "algorand-account" as const,
            name: synthesizeName(k, algorandAddress),
            address: algorandAddress,
            balance,
            assets: assets ?? [],
            metadata: { keyId: k.id, keyType: k.type, parentKeyId, ...encoded.metadata },
            sign: makeHookedSignFn(k.id),
          };
          addAccount<Account, AccountStoreState<Account>>({
            store: accountsStore,
            walletKey,
            account,
          });

          log?.info("Added algorand account with balance and assets:", {
            algorandAddress,
            balance,
            assets,
          });
        }
      }),
    );

    // Collect algorand account addresses from the store and update the subscriber
    const algorandAddresses = storedAccounts()
      .filter(isAlgorandAccount)
      .map((a) => a.address);

    log?.info("Algorand accounts updated, restarting subscriber with watchlist:", {
      algorandAddresses,
    });

    stopContainedSubscriber("updating watchlist");

    if (algorandAddresses.length > 0) {
      containedSubscriber = createSubscriberWithWatchlist(
        algorandClient,
        algorandAddresses,
        (address: string, assetId: bigint, amount: bigint) => {
          log?.debug("Balance change detected for address:", { address, assetId, amount });

          accountsStore.setState((state) => {
            const wallet = state.wallets[walletKey];
            if (!wallet) return state;
            return {
              ...state,
              wallets: {
                ...state.wallets,
                [walletKey]: {
                  ...wallet,
                  accounts: wallet.accounts.map((a) => {
                    if (!isAlgorandAccount(a)) return a;

                    const algorandAddress = a.address;
                    if (algorandAddress !== address) return a;

                    if (assetId === 0n) {
                      // Native ALGO balance update - add the delta
                      return { ...a, balance: (a.balance ?? 0n) + amount };
                    }

                    // ASA balance update — find by assetId string match and add delta
                    const assetIdStr = assetId.toString();
                    return {
                      ...a,
                      assets: (a.assets ?? []).map((asset) =>
                        asset.id === assetIdStr
                          ? { ...asset, balance: asset.balance + amount }
                          : asset,
                      ),
                    };
                  }),
                },
              },
            };
          });
        },
        (error) => {
          log?.error("Subscriber error:", { error });
        },
      );
      containedSubscriber.start();
    } else {
      // Keep subscriber fully stopped whenever no algorand-account exists.
      stopContainedSubscriber("no algorand accounts");
    }

    isProcessing = false;

    if (nextKeys) {
      const k = nextKeys;
      nextKeys = null;
      void processUpdates(k);
    }
  };

  keyStore.subscribe((state) => {
    if (state.status !== "ready" && state.status !== "idle") return;
    queueMicrotask(() => {
      void processUpdates(state.keys as unknown as Key[]);
    });
  });

  accountsStore.subscribe(() => {
    const hasAlgorandAccounts = storedAccounts().some(isAlgorandAccount);
    if (!hasAlgorandAccounts) {
      stopContainedSubscriber("no algorand accounts");
    }
  });

  return { algorand: clients };
};
