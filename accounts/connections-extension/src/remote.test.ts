import type { Account, AccountStoreState } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { remoteAccountsMirror, remoteWalletKey } from "./remote.ts";

/** An account carrying a locally backed signer (never travels the wire). */
type SignableAccount = Account & { sign?: (txns: Uint8Array[]) => Promise<Uint8Array[]> };

function makeStore(
  state: Partial<AccountStoreState<SignableAccount>> = {},
): Store<AccountStoreState<SignableAccount>> {
  return new Store<AccountStoreState<SignableAccount>>({
    wallets: {},
    activeWallet: null,
    ...state,
  });
}

describe("remoteAccountsMirror", () => {
  it("exposes the local wallet's accounts as data-only records", () => {
    const localSign = vi.fn();
    const store = makeStore({
      wallets: {
        local: {
          accounts: [
            {
              address: "ADDR",
              name: "Main",
              metadata: { keyType: "hd-derived-ed25519" },
              sign: localSign,
            },
          ],
          activeAccount: null,
        },
      },
      activeWallet: "local",
    });

    const exposed = remoteAccountsMirror(store, { walletKey: "local" }).expose();

    // Data only: the locally backed signer never travels the wire.
    expect(exposed).toEqual([
      { address: "ADDR", name: "Main", metadata: { keyType: "hd-derived-ed25519" } },
    ]);
  });

  it("defaults expose to the active wallet and excludes session mirrors", () => {
    const store = makeStore({
      wallets: {
        local: { accounts: [{ address: "LOCAL", name: "Local" }], activeAccount: null },
        [remoteWalletKey("session-1")]: {
          accounts: [{ address: "PEER", name: "Peer" }],
          activeAccount: null,
        },
      },
      activeWallet: "local",
    });
    const mirror = remoteAccountsMirror(store);

    expect(mirror.expose().map((a) => a.address)).toEqual(["LOCAL"]);

    // Even if a mirror ends up in the active slot, nothing echoes back.
    store.setState((s) => ({ ...s, activeWallet: remoteWalletKey("session-1") }));
    expect(mirror.expose()).toEqual([]);
  });

  it("mirrors peer accounts under the session's wallet key, attaching the context signer", async () => {
    const store = makeStore({
      wallets: { local: { accounts: [{ address: "LOCAL", name: "Local" }], activeAccount: null } },
      activeWallet: "local",
    });
    const mirror = remoteAccountsMirror(store, { walletKey: "local" });
    const rpc = vi.fn(async (txns: Uint8Array[]) => txns);
    const sign = vi.fn(() => rpc);

    mirror.receive("session-1", [{ address: "PEER", name: "Peer" }], { sign });

    const wallet = store.state.wallets[remoteWalletKey("session-1")];
    expect(wallet?.accounts).toHaveLength(1);
    expect(wallet?.activeAccount?.address).toBe("PEER");
    expect(sign).toHaveBeenCalledWith({ address: "PEER", name: "Peer" });
    // The mirrored record signs through the session-routed signer, not a keystore.
    const txns = [new Uint8Array([1])];
    await expect(wallet!.accounts[0].sign!(txns)).resolves.toEqual(txns);
    expect(rpc).toHaveBeenCalledWith(txns);
    // The local wallet is untouched.
    expect(store.state.wallets.local?.accounts.map((a) => a.address)).toEqual(["LOCAL"]);
    expect(store.state.activeWallet).toBe("local");
  });

  it("applies the expose projection override to the outbound records", () => {
    const store = makeStore({
      wallets: {
        local: { accounts: [{ address: "cGs=", name: "Bridged" }], activeAccount: null },
      },
      activeWallet: "local",
    });
    const mirror = remoteAccountsMirror(store, {
      walletKey: "local",
      // e.g. normalize keystore-bridged base64 addresses for the wire.
      expose: (accounts) => accounts.map((a) => ({ ...a, address: `normalized:${a.address}` })),
    });

    expect(mirror.expose()).toEqual([{ address: "normalized:cGs=", name: "Bridged" }]);
  });

  it("replaces a session's previous mirror on receive", () => {
    const store = makeStore();
    const mirror = remoteAccountsMirror(store);

    mirror.receive("session-1", [{ address: "OLD", name: "Old" }]);
    mirror.receive("session-1", [{ address: "NEW", name: "New" }]);

    expect(
      store.state.wallets[remoteWalletKey("session-1")]?.accounts.map((a) => a.address),
    ).toEqual(["NEW"]);
  });

  it("revokes exactly the session's mirror", () => {
    const store = makeStore({
      wallets: { local: { accounts: [{ address: "LOCAL", name: "Local" }], activeAccount: null } },
      activeWallet: "local",
    });
    const mirror = remoteAccountsMirror(store, { walletKey: "local" });
    mirror.receive("session-1", [{ address: "PEER-1", name: "Peer 1" }]);
    mirror.receive("session-2", [{ address: "PEER-2", name: "Peer 2" }]);

    mirror.revoke("session-1");

    expect(store.state.wallets[remoteWalletKey("session-1")]).toBeUndefined();
    expect(store.state.wallets[remoteWalletKey("session-2")]).toBeDefined();
    expect(store.state.wallets.local).toBeDefined();

    // Revoking an unknown session is a no-op.
    mirror.revoke("session-unknown");
    expect(store.state.wallets.local).toBeDefined();
  });
});
