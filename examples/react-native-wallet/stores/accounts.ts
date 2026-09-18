import type { AccountStoreState } from "@algorandfoundation/accounts";
import { Store } from "@tanstack/react-store";
import { HARDCODED_WATCHED_ADDRESS } from "@/extensions/example";
import { AppAccount } from "@/providers/ReactNativeProvider";

/**
 * The wallet key this app's accounts live under in the (use-wallet-shaped)
 * account store. Must match the provider `id` in `app/_layout.tsx`, since the
 * account extensions default their wallet key to it.
 */
export const WALLET_KEY = "wallet-provider";

export const accountsStore = new Store<AccountStoreState<AppAccount>>({
  wallets: {
    [WALLET_KEY]: {
      accounts: [
        {
          address: HARDCODED_WATCHED_ADDRESS,
          name: "Hardcoded Watched Account",
          type: "watched",
          balance: 1000000n,
          assets: [],
        },
      ],
      activeAccount: null,
    },
  },
  activeWallet: WALLET_KEY,
});

/** Selects the accounts under this app's wallet key. */
export function accountsOf(state: AccountStoreState<AppAccount>): AppAccount[] {
  return state.wallets[WALLET_KEY]?.accounts ?? [];
}
