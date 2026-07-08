import type { AccountAsset } from "@algorandfoundation/accounts-store";
import { AlgorandSubscriber } from "@algorandfoundation/algokit-subscriber";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";

const SUBSCRIBER_MAX_RETRIES = 3;
const SUBSCRIBER_RETRY_DELAY_MS = 2_000;
const POLLING_INTERVAL_MS = 4_000;

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
 * ContainedSubscriber manages periodic polling for balance changes on a set of Algorand
 * account addresses. Polling is driven by `pollOnce` and a `setTimeout` loop so it works
 * in environments (e.g. React Native) where `AbortController` / `DOMException` may be
 * unavailable.
 */
interface ContainedSubscriber {
  /** Begin periodic polling. Safe to call multiple times — subsequent calls are no-ops while already running. */
  start(): void;
  /** Stop periodic polling. The reason parameter is accepted for API symmetry but is not used internally. */
  stop(reason: string): void;
  /** List of Algorand account addresses being watched. */
  watchlist: string[];
}

/**
 * Create a ContainedSubscriber that periodically polls for balance changes on a specified list
 * of Algorand account addresses. Polling is performed via `AlgorandSubscriber.pollOnce` on a
 * `setTimeout`-based loop, avoiding any reliance on `AbortController` or `DOMException` so
 * that the subscriber works correctly in React Native environments.
 *
 * @param algorand - AlgorandClient instance
 * @param addresses - array of Algorand account addresses to watch
 * @param onBalanceChange - callback invoked whenever a balance change is detected for a watched address
 * @param onError - optional callback that receives errors after internal retries are exhausted
 * @returns A ContainedSubscriber whose `start` / `stop` control the polling loop
 */
export const createSubscriberWithWatchlist = (
  algorand: AlgorandClient,
  addresses: string[],
  onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void,
  onError?: (error: unknown) => void,
): ContainedSubscriber => {
  const { algod } = algorand.client;
  let watermark = 0n;
  let retryCount = 0;
  let stopped = true;
  let pollingTimer: ReturnType<typeof setTimeout> | null = null;

  const subscriber = new AlgorandSubscriber(
    {
      filters: [
        {
          name: "balance-changes",
          filter: {
            balanceChanges: [{ address: addresses }],
          },
        },
      ],
      syncBehaviour: "skip-sync-newest",
      maxRoundsToSync: 5,
      watermarkPersistence: {
        get: async () => watermark,
        set: async (value) => {
          watermark = value;
        },
      },
    },
    algod,
  );

  subscriber.on("balance-changes", async (event) => {
    for (const change of event.balanceChanges ?? []) {
      const { address, assetId, amount } = change;
      if (addresses.includes(address)) {
        onBalanceChange(address, assetId, amount);
      }
    }
  });

  const schedulePoll = (delayMs: number) => {
    if (stopped) return;
    pollingTimer = setTimeout(() => {
      void runPoll();
    }, delayMs);
  };

  const runPoll = async () => {
    if (stopped) return;
    try {
      await subscriber.pollOnce();
      retryCount = 0;
      schedulePoll(POLLING_INTERVAL_MS);
    } catch (error) {
      retryCount += 1;
      if (retryCount <= SUBSCRIBER_MAX_RETRIES) {
        schedulePoll(SUBSCRIBER_RETRY_DELAY_MS);
      } else {
        onError?.(error);
      }
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      retryCount = 0;
      schedulePoll(0);
    },
    stop(_reason: string) {
      stopped = true;
      if (pollingTimer !== null) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
      }
    },
    watchlist: addresses,
  };
};
