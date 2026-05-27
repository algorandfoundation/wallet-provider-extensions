import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAlgorandAccount, WithAlgorandAccounts } from "./extension.ts";
import { createSubscriberWithWatchlist, getAlgorandBalances } from "./algorand.ts";
import type { AccountStoreState } from "@algorandfoundation/accounts-store";
import {
  encodeAddress,
  generateXHDFromParent,
  generateXHDRootKeyFromSeed,
  type Key,
  type KeyStoreState,
} from "@algorandfoundation/keystore";
import { base64 } from "@scure/base";
import { Store } from "@tanstack/store";

vi.mock("./algorand.ts", () => ({
  getAlgorandBalances: vi.fn().mockResolvedValue({ balance: 1000n, assets: [] }),
  createSubscriberWithWatchlist: vi.fn().mockReturnValue({
    subscriber: { start: vi.fn(), stop: vi.fn() },
    watchlist: [],
  }),
}));

vi.mock("@algorandfoundation/algokit-utils", () => ({
  AlgorandClient: {
    fromConfig: vi.fn().mockReturnValue({
      client: { algod: {}, indexerIfPresent: null },
    }),
  },
}));

const FIXED_SEED = new Uint8Array(64).fill(1);

async function getMockKey(id: string, context = 0): Promise<Key> {
  const rootKey = await generateXHDRootKeyFromSeed({
    id: "seed-1",
    type: "hd-seed",
    privateKey: FIXED_SEED,
    algorithm: "raw",
    extractable: true,
  } as any);

  const keyData = {
    id,
    type: "hd-derived-ed25519" as const,
    metadata: {
      context,
      account: 0,
      index: parseInt(id.replace("key-", "")) || 0,
    },
  } as any;

  return generateXHDFromParent({ key: keyData, parentKey: rootKey }) as Promise<Key>;
}

/** Flush setImmediate callbacks and any queued microtasks after them. */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeProvider() {
  return {
    account: {
      store: {
        addAccount: vi.fn(),
        removeAccount: vi.fn(),
      },
    },
    key: {
      store: {
        sign: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      },
    },
  };
}

function makeOptions(accountsStore: Store<AccountStoreState<any>>, keyStore: Store<KeyStoreState>) {
  return {
    accounts: { store: accountsStore },
    keystore: { store: keyStore },
    algorand: {
      network: "testnet-v1.0",
      algodConfig: { server: "http://localhost", port: 4001, token: "" },
    },
  };
}

describe("isAlgorandAccount", () => {
  it("returns true for an account with type algorand-account", () => {
    const account = { type: "algorand-account", address: "addr" } as any;
    expect(isAlgorandAccount(account)).toBe(true);
  });

  it("returns false for an account with a different type", () => {
    const account = { type: "keystore-account", address: "addr" } as any;
    expect(isAlgorandAccount(account)).toBe(false);
  });
});

describe("WithAlgorandAccounts", () => {
  it("throws when provider.account is missing", () => {
    const provider = { key: { store: {} } };
    expect(() => WithAlgorandAccounts(provider as any, {} as any)).toThrow(
      "AlgorandAccounts extension requires WithAccountStore extension to be present on the provider.",
    );
  });

  it("throws when provider.key is missing", () => {
    const provider = { account: { store: {} } };
    expect(() => WithAlgorandAccounts(provider as any, {} as any)).toThrow(
      "AlgorandAccounts extension requires WithKeyStore extension to be present on the provider.",
    );
  });

  it("adds an algorand account when a new key is added to the keystore", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(provider.account.store.addAccount).toHaveBeenCalledTimes(1);

    const added = (provider.account.store.addAccount as any).mock.calls[0][0];
    expect(added.type).toBe("algorand-account");
    expect(added.address).toBe(base64.encode(mockKey.publicKey!));
    expect(added.metadata?.keyId).toBe(mockKey.id);
    expect(added.balance).toBe(1000n);
    expect(added.assets).toEqual([]);
  });

  it("does not add a duplicate account when the address already exists in the account store", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);

    const accountsStore = new Store<AccountStoreState<any>>({
      accounts: [{ type: "algorand-account", address, metadata: { keyId: mockKey.id } }],
    });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(provider.account.store.addAccount).not.toHaveBeenCalled();
  });

  it("removes an algorand account when the corresponding key is removed from the keystore", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);

    const accountsStore = new Store<AccountStoreState<any>>({
      accounts: [{ type: "algorand-account", address, metadata: { keyId: mockKey.id } }],
    });
    const keyStore = new Store<KeyStoreState>({ keys: [mockKey], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [], status: "idle" }));
    await flushAsync();

    expect(provider.account.store.removeAccount).toHaveBeenCalledWith(address);
  });

  it("adds multiple accounts when multiple new keys are added", async () => {
    const mockKey1 = await getMockKey("key-1");
    const mockKey2 = await getMockKey("key-2");

    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey1, mockKey2], status: "idle" }));
    await flushAsync();

    expect(provider.account.store.addAccount).toHaveBeenCalledTimes(2);
  });

  it("provides a sign method that delegates to key.store.sign", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    const added = (provider.account.store.addAccount as any).mock.calls[0][0];
    const txn = new Uint8Array([1, 2, 3]);
    const signedTxns = await added.sign([txn]);

    expect(provider.key.store.sign).toHaveBeenCalledWith(mockKey.id, txn);
    expect(signedTxns[0]).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("does not add an account for a key with a non-zero context", async () => {
    const nonZeroContextKey = await getMockKey("key-1", 1);
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [nonZeroContextKey], status: "idle" }));
    await flushAsync();

    expect(provider.account.store.addAccount).not.toHaveBeenCalled();
  });

  it("skips processing when keystore status is not ready or idle", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "loading" as any }));
    await flushAsync();

    expect(provider.account.store.addAccount).not.toHaveBeenCalled();
  });

  it("returns the provider instance", async () => {
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    const result = WithAlgorandAccounts(
      provider as any,
      makeOptions(accountsStore, keyStore) as any,
    );

    expect(result).toBe(provider);
  });
});

describe("AlgorandSubscriber behavior", () => {
  const mockCreateSubscriberWithWatchlist = vi.mocked(createSubscriberWithWatchlist) as any;
  const mockGetAlgorandBalances = vi.mocked(getAlgorandBalances) as any;

  /**
   * Override addAccount to propagate into the real accountsStore so the extension
   * can find accounts when collecting addresses for the subscriber watchlist.
   */
  function makeProviderWithStore(accountsStore: Store<AccountStoreState<any>>) {
    const provider = makeProvider();
    (provider.account.store.addAccount as any).mockImplementation((account: any) => {
      accountsStore.setState((s) => ({ ...s, accounts: [...s.accounts, account] }));
    });
    return provider;
  }

  beforeEach(() => {
    mockCreateSubscriberWithWatchlist.mockReset();
    mockGetAlgorandBalances.mockReset();
    mockGetAlgorandBalances.mockResolvedValue({ balance: 1000n, assets: [] });
  });

  it("starts the subscriber after an algorand account is added", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithStore(accountsStore);

    const mockStart = vi.fn();
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], _cb: any) => ({
        subscriber: { start: mockStart, stop: vi.fn() },
        watchlist: _addresses,
      }),
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(createSubscriberWithWatchlist).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("does not create a subscriber when the added key is not an hd-derived-ed25519 key", async () => {
    const nonEdKey = { id: "non-ed-key", type: "rsa", publicKey: new Uint8Array(32) } as any;
    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [nonEdKey], status: "idle" }));
    await flushAsync();

    expect(createSubscriberWithWatchlist).not.toHaveBeenCalled();
  });

  it("updates the native ALGO balance when a balance change is detected", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);
    const algorandAddress = encodeAddress(mockKey.publicKey!);

    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithStore(accountsStore);

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { subscriber: { start: vi.fn(), stop: vi.fn() }, watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Simulate a native ALGO balance change of +500n
    onBalanceChange!(algorandAddress, 0n, 500n);

    const account = accountsStore.state.accounts.find((a) => a.address === address) as any;
    expect(account.balance).toBe(1500n);
  });

  it("updates an ASA balance when a balance change is detected for that asset", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);
    const algorandAddress = encodeAddress(mockKey.publicKey!);

    mockGetAlgorandBalances.mockResolvedValueOnce({
      balance: 1000n,
      assets: [{ id: "12345", name: "TestToken", type: "asa", balance: 200n, metadata: {} }],
    });

    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithStore(accountsStore);

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { subscriber: { start: vi.fn(), stop: vi.fn() }, watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Simulate an ASA 12345 balance change of +100n
    onBalanceChange!(algorandAddress, 12345n, 100n);

    const account = accountsStore.state.accounts.find((a) => a.address === address) as any;
    const asset = account.assets.find((a: any) => a.id === "12345");
    expect(asset.balance).toBe(300n);
  });

  it("ignores balance changes for unrecognised addresses", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);

    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithStore(accountsStore);

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { subscriber: { start: vi.fn(), stop: vi.fn() }, watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Fire callback for a completely different address
    onBalanceChange!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 0n, 999n);

    const account = accountsStore.state.accounts.find((a) => a.address === address) as any;
    expect(account.balance).toBe(1000n); // unchanged
  });

  it("stops the old subscriber and starts a new one when a second key is added", async () => {
    const mockKey1 = await getMockKey("key-1");
    const mockKey2 = await getMockKey("key-2");

    const accountsStore = new Store<AccountStoreState<any>>({ accounts: [] });
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithStore(accountsStore);

    const subscribers: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], _cb: any) => {
        const sub = { start: vi.fn(), stop: vi.fn() };
        subscribers.push(sub);
        return { subscriber: sub, watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    // First key — first subscriber created
    keyStore.setState((s) => ({ ...s, keys: [mockKey1], status: "idle" }));
    await flushAsync();

    expect(subscribers).toHaveLength(1);
    expect(subscribers[0].start).toHaveBeenCalledTimes(1);

    // Second key added — first subscriber stopped, new one started
    keyStore.setState((s) => ({ ...s, keys: [mockKey1, mockKey2], status: "idle" }));
    await flushAsync();

    expect(subscribers[0].stop).toHaveBeenCalledWith("updating watchlist");
    expect(subscribers).toHaveLength(2);
    expect(subscribers[1].start).toHaveBeenCalledTimes(1);
  });
});
