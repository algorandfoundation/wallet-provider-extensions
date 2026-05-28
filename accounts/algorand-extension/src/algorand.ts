import type { AccountAsset } from "@algorandfoundation/accounts-store";
import { AlgorandSubscriber } from "@algorandfoundation/algokit-subscriber";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";

const SUBSCRIBER_MAX_RETRIES = 3;
const SUBSCRIBER_RETRY_DELAY_MS = 2_000;

/**
 * Get Algorand account balance and assets for a given address.
 * @param algorand - The AlgorandClient instance to use
 * @param address - The Algorand account address to query.
 * @returns An object containing the account balance in microAlgos and an optional list of assets.
 * @throws Will throw an error if the account information cannot be retrieved from Algod.
 */
export const getAlgorandBalances = async (
  algorand: AlgorandClient,
  address: string,
): Promise<{ balance: bigint; assets?: AccountAsset[] }> => {
  const { balance, assets } = await algorand.account.getInformation(address);

  const accountAssets: AccountAsset[] | undefined = assets
    ? await Promise.all(
        assets.map(async (asset) => {
          const assetInfo = await algorand.asset.getById(asset.assetId);

          return {
            id: asset.assetId.toString(),
            name: assetInfo.assetName ?? "",
            type: "asa",
            balance: asset.amount,
            metadata: {
              ...assetInfo,
            },
          };
        }),
      )
    : undefined;

  return {
    balance: balance.microAlgos,
    assets: accountAssets,
  };
};

/**
 * ContainedSubscriber is an interface that defines the structure of an object containing an AlgorandSubscriber instance and a watchlist of Algorand account addresses.
 */
interface ContainedSubscriber {
  /**
   * Subscriber instance that listens for balance changes on the specified Algorand account addresses. The subscriber will trigger updates to the account information in the store whenever a balance change is detected for any of the watched addresses.
   */
  readonly subscriber: AlgorandSubscriber;
  /**
   * List of Algorand account addresses being watched
   */
  watchlist: string[];
}

/**
 * Create an AlgorandSubscriber that listens for balance changes on a specified list of Algorand account addresses.
 * @param algorand - AlgorandClient instance
 * @param addresses - array of Algorand account addresses to watch
 * @param onBalanceChange - callback function that will be triggered whenever a balance change is detected for any of the watched addresses.
 * @param onError - optional callback that receives subscriber errors after internal retries are exhausted.
 * @returns An instance of AlgorandSubscriber that will listen for balance changes on the specified accounts
 */
export const createSubscriberWithWatchlist = (
  algorand: AlgorandClient,
  addresses: string[],
  onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void,
  onError?: (error: unknown) => void,
): ContainedSubscriber => {
  const { algod } = algorand.client;
  let watermark = 0n; // Each instance maintains its own watermark
  let retryCount = 0;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const subscriber = new AlgorandSubscriber(
    {
      filters: [
        {
          name: "balance-changes",
          filter: {
            balanceChanges: [
              {
                address: addresses, // Watch for balance changes on the specified addresses
              },
            ],
          },
        },
      ],
      syncBehaviour: "skip-sync-newest",
      maxRoundsToSync: 5,
      waitForBlockWhenAtTip: true,
      watermarkPersistence: {
        get: async () => watermark,
        set: async (value) => {
          watermark = value;
        },
      },
    },
    algod,
  );

  subscriber.onError(async (subscriberError) => {
    retryCount += 1;

    if (retryCount <= SUBSCRIBER_MAX_RETRIES) {
      await delay(SUBSCRIBER_RETRY_DELAY_MS);
      subscriber.start();
      return;
    }

    onError?.(subscriberError);
  });

  subscriber.on("balance-changes", async (event) => {
    retryCount = 0;

    // we can assume only the watchlist addresses are included
    for (const change of event.balanceChanges ?? []) {
      const { address, assetId, amount } = change;

      // if address is contained within the watchlist, trigger the onBalanceChange callback
      if (addresses.includes(address)) {
        onBalanceChange(address, assetId, amount);
      }
    }
  });

  return {
    subscriber,
    watchlist: addresses,
  };
};
