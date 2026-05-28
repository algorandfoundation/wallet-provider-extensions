import { createSubscriberWithWatchlist, getAlgorandBalances } from "./algorand.ts";
import type { Account, AccountAsset, AccountStoreState } from "@algorandfoundation/accounts-store";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { Key, KeyStoreState, XHDDerivedKeyData } from "@algorandfoundation/keystore";
import { base64 } from "@scure/base";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import type { LogStoreApi, LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type {
  AlgorandAccount,
  AlgorandAccountsExtension,
  AlgorandAccountsExtensionOptions,
} from "./types.ts";
import { encodeAddress } from "algosdk";

export function isAlgorandAccount(account: Account): account is AlgorandAccount {
  return account.type === "algorand-account";
}

export const WithAlgorandAccounts: Extension<AlgorandAccountsExtension> = (
  provider: LogStoreExtension & any,
  options: AlgorandAccountsExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.account) {
    throw new Error(
      "AlgorandAccounts extension requires WithAccountStore extension to be present on the provider.",
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

  // Attach typed algod / indexer clients to `provider.algorand` (only
  // if a previously-loaded Algorand-aware extension hasn't already
  // done so). This lets hooks / screens reuse a single client pair
  // instead of building their own from env config.
  if (!provider.algorand) {
    provider.algorand = {
      algod: algorandClient.client.algod,
      indexer: algorandClient.client.indexerIfPresent ?? null,
    };
  }
  // Get the store from the options
  const accountsStore: Store<AccountStoreState<Account>> = options.accounts.store;
  // Get the keystore from the options
  const keyStore: Store<KeyStoreState> = options.keystore.store;
  // Get or create hooks for algorand account operations
  const hooks = options.algorand.hooks ?? new Hook.Collection<any>();
  // clone of keystore at starting point prior to execution
  const keys = [...((keyStore.state.keys as Key[]) ?? [])];

  let isProcessing = false;
  let nextKeys: Key[] | null = null;
  let containedSubscriber: ReturnType<typeof createSubscriberWithWatchlist> | null = null;

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
        if (k.type === "hd-derived-ed25519" && k.publicKey) {
          const address = base64.encode(k.publicKey);
          const account = accountsStore.state.accounts.find((a) => a.address === address);
          if (account && account.metadata?.keyId === k.id && account.type === "algorand-account") {
            log?.info(`Removing algorand account for key ${k.id}-${k.type}...`);
            provider.account.store.removeAccount(address);
          }
        }
      }),
    );

    // Add algorand accounts for added keys
    await Promise.all(
      addedKeys.map(async (k) => {
        if (k.type === "hd-derived-ed25519" && k.publicKey && k.metadata?.context === 0) {
          const address = base64.encode(k.publicKey);

          log?.info(`Checking algorand account balances for key ${k.id}-${k.type}... ${address}`);

          const algorandAddress = encodeAddress(k.publicKey);
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
          if (
            !accountsStore.state.accounts.some(
              (a) => a.address === address && k.metadata?.context === 0,
            )
          ) {
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

            provider.account.store.addAccount({
              type: "algorand-account" as const,
              address: address,
              balance,
              assets: assets ?? [],
              metadata: { keyId: k.id, parentKeyId: parentKeyId },
              sign: makeHookedSignFn(k.id),
            });

            log?.info("Added algorand account with balance and assets:", { address });
          }
        }
      }),
    );

    // Collect algorand account addresses from the store and update the subscriber
    const algorandAddresses = accountsStore.state.accounts
      .filter(isAlgorandAccount)
      .map((a) => encodeAddress(base64.decode(a.address)));

    log?.info("Algorand accounts updated, restarting subscriber with watchlist:", {
      algorandAddresses,
    });

    if (containedSubscriber) {
      containedSubscriber.subscriber.stop("updating watchlist");
      containedSubscriber = null;
    }

    if (algorandAddresses.length > 0) {
      containedSubscriber = createSubscriberWithWatchlist(
        algorandClient,
        algorandAddresses,
        (address: string, assetId: bigint, amount: bigint) => {
          log?.debug("Balance change detected for address:", { address, assetId, amount });

          accountsStore.setState((state) => ({
            ...state,
            accounts: state.accounts.map((a) => {
              if (!isAlgorandAccount(a)) return a;
              // Algorand address in the callback is in standard format; account address is base64
              const algorandAddress = encodeAddress(base64.decode(a.address));
              if (algorandAddress !== address) return a;

              if (assetId === 0n) {
                // Native ALGO balance update - add the delta
                return { ...a, balance: a.balance + amount };
              }

              // ASA balance update — find by assetId string match and add delta
              const assetIdStr = assetId.toString();
              return {
                ...a,
                assets: a.assets.map((asset) =>
                  asset.id === assetIdStr ? { ...asset, balance: asset.balance + amount } : asset,
                ),
              };
            }),
          }));
        },
        (error) => {
          log?.error("Subscriber error:", { error });
        },
      );
      containedSubscriber.subscriber.start();
    }

    isProcessing = false;

    if (nextKeys) {
      const k = nextKeys;
      nextKeys = null;
      processUpdates(k);
    }
  };

  keyStore.subscribe((state) => {
    if (state.status !== "ready" && state.status !== "idle") return;
    queueMicrotask(() => {
      void processUpdates(state.keys as unknown as Key[]);
    });
  });

  return provider as unknown as AlgorandAccountsExtension;
};
