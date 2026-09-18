import { Store } from "@tanstack/store";
import { bench, describe } from "vitest";
import { addAccount, getAccount, removeAccount } from "./store.ts";
import type { Account, AccountStoreState } from "./types.ts";

describe("Account Store Benchmarks", () => {
  const walletKey = "bench-wallet";
  const store = new Store<AccountStoreState<Account>>({
    wallets: {},
    activeWallet: null,
  });
  const baseAccount: Account = {
    name: "Bench Account",
    address: "A".repeat(58),
    type: "ed25519",
    balance: BigInt(0),
    assets: [],
  };

  bench("addAccount", () => {
    addAccount({
      store,
      walletKey,
      account: { ...baseAccount, address: Math.random().toString(36) },
    });
  });

  bench("getAccount", () => {
    getAccount({ store, walletKey, address: baseAccount.address });
  });

  bench("removeAccount", () => {
    removeAccount({ store, walletKey, address: baseAccount.address });
  });
});
