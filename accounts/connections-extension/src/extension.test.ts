import type { Account, AccountStoreState } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { WithAccountsConnections } from "./extension.ts";
import { remoteWalletKey } from "./remote.ts";

function makeStore(
  state: Partial<AccountStoreState<Account>> = {},
): Store<AccountStoreState<Account>> {
  return new Store<AccountStoreState<Account>>({
    wallets: {},
    activeWallet: null,
    ...state,
  });
}

describe("WithAccountsConnections", () => {
  it("mounts the remote mirror over the injected shared store", () => {
    const store = makeStore({
      wallets: {
        "wallet-1": { accounts: [{ address: "ADDR", name: "Main" }], activeAccount: null },
      },
      activeWallet: "wallet-1",
    });
    const provider = { id: "wallet-1" } as any;

    const extension = WithAccountsConnections<Account>(provider, { accounts: { store } });

    expect(extension.account.remote).toBeDefined();
    expect(extension.account.remote.expose()).toEqual([{ address: "ADDR", name: "Main" }]);

    // Receive feeds the same reactive state the store extension reads.
    extension.account.remote.receive("session-1", [{ address: "PEER", name: "Peer" }]);
    expect(store.state.wallets[remoteWalletKey("session-1")]?.accounts).toEqual([
      { address: "PEER", name: "Peer" },
    ]);
    // Session mirrors never echo back through expose.
    expect(extension.account.remote.expose().map((a) => a.address)).toEqual(["ADDR"]);
  });

  it("is idempotent: reuses an already-mounted provider.account.remote", () => {
    const store = makeStore();
    const mounted = { expose: () => [], receive: () => {}, revoke: () => {} };
    const provider = { id: "wallet-1", account: { remote: mounted } } as any;

    const extension = WithAccountsConnections<Account>(provider, { accounts: { store } });

    expect(extension.account.remote).toBe(mounted);
  });

  it("throws a clear error when the shared store is missing", () => {
    const provider = { id: "wallet-1" } as any;

    expect(() => WithAccountsConnections<Account>(provider)).toThrow(
      "WithAccountsConnections requires options.accounts.store (the shared accounts store)",
    );
    expect(() => WithAccountsConnections<Account>(provider, { accounts: {} })).toThrow(
      "WithAccountsConnections requires options.accounts.store (the shared accounts store)",
    );
  });

  it("honors the remote.expose projection", () => {
    const store = makeStore({
      wallets: {
        "wallet-1": { accounts: [{ address: "cGs=", name: "Bridged" }], activeAccount: null },
      },
      activeWallet: "wallet-1",
    });
    const provider = { id: "wallet-1" } as any;

    const extension = WithAccountsConnections<Account>(provider, {
      accounts: {
        store,
        remote: {
          expose: (accounts) => accounts.map((a) => ({ ...a, address: `normalized:${a.address}` })),
        },
      },
    });

    expect(extension.account.remote.expose()).toEqual([
      { address: "normalized:cGs=", name: "Bridged" },
    ]);
  });

  it("honors an explicit walletKey over the provider id default", () => {
    const store = makeStore({
      wallets: {
        "wallet-1": { accounts: [{ address: "DEFAULT", name: "Default" }], activeAccount: null },
        custom: { accounts: [{ address: "CUSTOM", name: "Custom" }], activeAccount: null },
      },
      activeWallet: "wallet-1",
    });
    const provider = { id: "wallet-1" } as any;

    const extension = WithAccountsConnections<Account>(provider, {
      accounts: { store, walletKey: "custom" },
    });

    expect(extension.account.remote.expose().map((a) => a.address)).toEqual(["CUSTOM"]);
  });
});
