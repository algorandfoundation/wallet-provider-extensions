import type { Account, AccountStoreState } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { WithAccounts } from "./extension.ts";

function makeStore(
  state: Partial<AccountStoreState<Account>> = {},
): Store<AccountStoreState<Account>> {
  return new Store<AccountStoreState<Account>>({
    wallets: {},
    activeWallet: null,
    ...state,
  });
}

describe("WithAccounts (meta)", () => {
  it("threads the shared store to both the core store and the bridge mirror", async () => {
    const store = makeStore();
    const provider: any = { id: "wallet-1" };

    const api = WithAccounts<Account>(provider, { accounts: { store } });

    // The remote mirror is attached once the dynamic bridge import resolves;
    // `store.ready` settles exactly when it has.
    await api.account.store.ready;
    expect(api.account.remote).toBeDefined();

    // Writes through the store API are visible to the mirror: one shared store.
    await api.account.store.addAccount({ address: "ADDR", name: "Main" });
    expect(api.accounts).toEqual([{ address: "ADDR", name: "Main" }]);
    expect(api.account.remote!.expose()).toEqual([{ address: "ADDR", name: "Main" }]);

    // ... and records the mirror receives ride the same reactive state.
    api.account.remote!.receive("session-1", [{ address: "PEER", name: "Peer" }]);
    expect(store.state.wallets["remote:session-1"]?.accounts).toEqual([
      { address: "PEER", name: "Peer" },
    ]);
  });

  it("attaches the remote mirror onto the shared namespace object", async () => {
    const provider: any = { id: "wallet-1" };

    const api = WithAccounts<Account>(provider, {});
    // The reference a consumer takes before the bridge resolves...
    const namespace = api.account;

    await api.account.store.ready;
    expect(api.account.remote).toBeDefined();

    // ...carries the mirror too: the namespace is shared, not shallow-copied.
    expect(namespace.remote).toBe(api.account.remote);
  });

  it("honors the remote expose projection and the extension's wallet key", async () => {
    const store = makeStore({
      wallets: {
        "wallet-1": { accounts: [{ address: "cGs=", name: "Bridged" }], activeAccount: null },
      },
      activeWallet: "wallet-1",
    });
    const provider: any = { id: "wallet-1" };

    const api = WithAccounts<Account>(provider, {
      accounts: {
        store,
        remote: {
          expose: (accounts) => accounts.map((a) => ({ ...a, address: `normalized:${a.address}` })),
        },
      },
    });

    await api.account.store.ready;

    expect(api.account.remote!.expose()).toEqual([{ address: "normalized:cGs=", name: "Bridged" }]);
  });

  it("degrades gracefully when the bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/accounts-connections-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/accounts-connections-extension'");
    });
    try {
      const provider: any = { id: "wallet-1" };

      // Mounting must not throw; the bridge import rejection is swallowed.
      const api = WithAccounts<Account>(provider, {});

      // `ready` still resolves (never rejects) when the bridge is missing.
      await expect(api.account.store.ready).resolves.toBeUndefined();

      expect(api.account.remote).toBeUndefined();
      // The local store surface still works without the bridge.
      await api.account.store.addAccount({ address: "ADDR", name: "Main" });
      expect(api.accounts).toEqual([{ address: "ADDR", name: "Main" }]);
    } finally {
      vi.doUnmock("@algorandfoundation/accounts-connections-extension");
    }
  });

  it("attaches ready onto the store API instance the core mounted", async () => {
    const store = makeStore();
    const provider: any = { id: "wallet-1" };

    // First mount owns the store API; a second (incremental) mount reuses it.
    const first = WithAccounts<Account>(provider, { accounts: { store } });
    provider.account = first.account;
    const second = WithAccounts<Account>(provider, { accounts: { store } });

    // The reused instance carries `ready` — not a copy.
    expect(second.account.store).toBe(first.account.store);
    expect(second.account.store.ready).toBeInstanceOf(Promise);

    // Awaiting after (or twice) is idempotent: the same settled promise.
    await second.account.store.ready;
    await second.account.store.ready;
    expect(second.account.remote).toBeDefined();
  });
});
