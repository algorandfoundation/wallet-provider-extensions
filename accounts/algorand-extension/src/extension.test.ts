import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isAlgorandAccount, WithAlgorandAccounts } from "./extension.ts";
import { createSubscriberWithWatchlist, getAlgorandBalances } from "./algorand.ts";
import type { AccountStoreState } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import type { Key, KeyStoreState } from "@algorandfoundation/keystore-core";
import {
  createKeyStore,
  type DriverCapabilities,
  type DriverMaterial,
  type KeyId,
  type KeyStore,
  type KeyStoreDriver,
  type XHDBinding,
  withSubtleXHD,
} from "@algorandfoundation/keystore-core";
import { fromSeed, harden, KeyContext, XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
import { encodeAddress } from "algosdk";
import { canonicalPQAddress, PQ_SCHEME_FALCON1024 } from "./pq-address.ts";
import type { AlgorandAccount } from "./types.ts";

vi.mock("./algorand.ts", () => ({
  getAlgorandBalances: vi.fn().mockResolvedValue({ balance: 1000n, assets: [] }),
  createSubscriberWithWatchlist: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
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
const host = globalThis.crypto.subtle;

// Accounts are scoped under the provider's wallet key in the shared,
// use-wallet-shaped store.
const WALLET_KEY = "test-provider";
const accountsOf = (store: Store<AccountStoreState<any>>): AlgorandAccount[] =>
  (store.state.wallets[WALLET_KEY]?.accounts ?? []) as AlgorandAccount[];

// Same adapter shape `keystore-core`'s own tests use: exposes the (otherwise
// private) rawSign of XHDWalletAPI so the shim can drive derivation.
const xhdApi = new XHDWalletAPI();
const xhd: XHDBinding = {
  fromSeed: (seed) => fromSeed(Buffer.from(seed)),
  deriveKey: (rootKey, bip44Path, isPrivate, derivationType) =>
    xhdApi.deriveKey(rootKey, bip44Path, isPrivate, derivationType),
  rawSign: (rootKey, bip44Path, data, derivationType) =>
    // @ts-expect-error accessing the private rawSign to build the binding
    xhdApi.rawSign(rootKey, bip44Path, data, derivationType),
  verifyWithPublicKey: (signature, msg, publicKey) =>
    xhdApi.verifyWithPublicKey(signature, msg, publicKey),
  ecdh: (rootKey, bip44Path, otherPartyPub, meFirst, derivationType) => {
    const context = bip44Path[1] === harden(283) ? KeyContext.Address : KeyContext.Identity;
    const account = (bip44Path[2] ?? harden(0)) & 0x7fff_ffff;
    const keyIndex = (bip44Path[4] ?? 0) & 0x7fff_ffff;
    return xhdApi.ECDH(rootKey, context, account, keyIndex, otherPartyPub, meFirst, derivationType);
  },
};

const DRIVER_CAPABILITIES: DriverCapabilities = {
  nativeCryptoKey: false,
  interactiveUnlock: false,
  authFactors: [],
};

/**
 * A minimal in-memory {@link KeyStoreDriver}, mirroring the fixture used by
 * `keystore-core`'s own `create.test.ts`, so this suite can produce real
 * `Key` fixtures (with genuine derived public keys) through `createKeyStore`.
 */
function createFixtureDriver(): KeyStoreDriver<void> {
  const materials = new Map<KeyId, Uint8Array>();
  const metadata = new Map<KeyId, Key>();

  return {
    capabilities: DRIVER_CAPABILITIES,

    async put(id: KeyId, material: DriverMaterial): Promise<void> {
      if (material.kind !== "bytes") {
        throw new Error("fixture driver cannot persist a CryptoKey");
      }
      materials.set(id, Uint8Array.from(material.bytes));
    },

    async use<T>(id: KeyId, _ctx: void, fn: (material: DriverMaterial) => T | Promise<T>) {
      const bytes = materials.get(id);
      if (!bytes) throw new Error(`no material for ${id}`);
      return fn({ kind: "bytes", bytes });
    },

    async remove(id: KeyId): Promise<void> {
      materials.delete(id);
      metadata.delete(id);
    },

    async putMeta(key: Key): Promise<void> {
      metadata.set(key.id, key);
    },

    async getMeta(id: KeyId): Promise<Key | undefined> {
      return metadata.get(id);
    },

    async listMeta(): Promise<Key[]> {
      return [...metadata.values()];
    },
  };
}

// A single real keystore engine (in-memory driver + XHD shim) shared across
// every test in this file, used to mint realistic `Key` fixtures on demand.
let keystoreEngine: KeyStore<void>;
let rootId: string;

beforeAll(async () => {
  keystoreEngine = createKeyStore<void>({
    driver: createFixtureDriver(),
    store: new Store<KeyStoreState>({ keys: [], status: "idle" }),
    subtle: host,
    shims: [(h) => withSubtleXHD(h, xhd)],
  });
  await keystoreEngine.ready;

  const seedId = await keystoreEngine.importSeed!(FIXED_SEED);
  rootId = await keystoreEngine.generate({
    type: "hd-root-key",
    algorithm: "raw",
    extractable: false,
    keyUsages: ["deriveBits", "deriveKey"],
    params: { parentKeyId: seedId },
  });
});

/** Derives a real `hd-derived-ed25519` key via the XHD engine. */
async function getMockKey(id: string, context = 0): Promise<Key> {
  const index = Number.parseInt(id.replace("key-", ""), 10) || 0;
  const keyId = await keystoreEngine.deriveFromSeed!(
    rootId,
    `m/44'/${context === 0 ? "283" : "0"}'/0'/0/${index}`,
    {
      id,
      algorithm: "EdDSA",
      metadata: { context, account: 0, index },
    },
  );
  return (await keystoreEngine.export(keyId)) as unknown as Key;
}

/** Flush setImmediate callbacks and any queued microtasks after them. */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeProvider() {
  return {
    id: WALLET_KEY,
    account: { store: {} },
    key: {
      store: {
        sign: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      },
    },
  };
}

function makeProviderWithLog() {
  return {
    ...makeProvider(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      clear: vi.fn(),
    },
  };
}

function makeAccountsStore(
  accounts: Partial<AlgorandAccount>[] = [],
): Store<AccountStoreState<any>> {
  if (accounts.length === 0) {
    return new Store<AccountStoreState<any>>({ wallets: {}, activeWallet: null });
  }
  return new Store<AccountStoreState<any>>({
    wallets: {
      [WALLET_KEY]: { accounts: accounts as AlgorandAccount[], activeAccount: null },
    },
    activeWallet: WALLET_KEY,
  });
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
      "AlgorandAccounts extension requires WithAccounts extension to be present on the provider.",
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
    const address = encodeAddress(mockKey.publicKey!);
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(1);

    const added = accountsOf(accountsStore)[0];
    expect(added.type).toBe("algorand-account");
    expect(added.address).toBe(address);
    expect(added.metadata?.keyId).toBe(mockKey.id);
    expect(added.balance).toBe(1000n);
    expect(added.assets).toEqual([]);
    expect(accountsStore.state.activeWallet).toBe(WALLET_KEY);
  });

  it("uses provider.log when present", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProviderWithLog();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(provider.log.info).toHaveBeenCalled();
  });

  it("does not add a duplicate account when the address already exists in the account store", async () => {
    const mockKey = await getMockKey("key-1");
    const address = encodeAddress(mockKey.publicKey!);

    const existing = { type: "algorand-account", address, metadata: { keyId: mockKey.id } };
    const accountsStore = makeAccountsStore([existing as any]);
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(1);
    // The pre-existing account object was left untouched (not re-added).
    expect(accountsOf(accountsStore)[0]).toBe(existing);
  });

  it("removes an algorand account when the corresponding key is removed from the keystore", async () => {
    const mockKey = await getMockKey("key-1");
    const address = encodeAddress(mockKey.publicKey!);

    const accountsStore = makeAccountsStore([
      { type: "algorand-account", address, metadata: { keyId: mockKey.id } } as any,
    ]);
    const keyStore = new Store<KeyStoreState>({ keys: [mockKey], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore).find((a) => a.address === address)).toBeUndefined();
  });

  it("adds multiple accounts when multiple new keys are added", async () => {
    const mockKey1 = await getMockKey("key-1");
    const mockKey2 = await getMockKey("key-2");

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey1, mockKey2], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(2);
  });

  it("provides a sign method that delegates to key.store.sign", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    const added = accountsOf(accountsStore)[0];
    const txn = new Uint8Array([1, 2, 3]);
    const signedTxns = await added.sign([txn]);

    expect(provider.key.store.sign).toHaveBeenCalledWith(mockKey.id, txn);
    expect(signedTxns[0]).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("does not add an account for a key with a non-zero context", async () => {
    const nonZeroContextKey = await getMockKey("key-1", 1);
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [nonZeroContextKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(0);
  });

  it("skips processing when keystore status is not ready or idle", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "loading" as any }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(0);
  });

  it("mounts the shared algod / indexer clients on the provider", async () => {
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    const result = WithAlgorandAccounts(
      provider as any,
      makeOptions(accountsStore, keyStore) as any,
    );

    expect(result.algorand).toEqual({ algod: {}, indexer: null });
  });
});

describe("address encoding for standalone key types", () => {
  it("adds an algorand account for a standalone ed25519 key", async () => {
    const publicKey = new Uint8Array(32).fill(7);
    const ed25519Key = { id: "ed-key-1", type: "ed25519", publicKey } as unknown as Key;
    const address = encodeAddress(publicKey);

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [ed25519Key], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(1);

    const added = accountsOf(accountsStore)[0];
    expect(added.address).toBe(address);
    expect(added.address).toHaveLength(58);
    expect(added.metadata?.keyId).toBe("ed-key-1");
    expect(added.metadata?.keyType).toBe("ed25519");
    expect(added.metadata?.pqScheme).toBeUndefined();
    expect(added.metadata?.pqSalt).toBeUndefined();
  });

  it("adds an algorand account for a falcon-1024 key using the canonical PQ address", async () => {
    const publicKey = new Uint8Array(1793).fill(3);
    const falconKey = { id: "falcon-key-1", type: "falcon-1024", publicKey } as unknown as Key;
    const { address: digest, salt } = canonicalPQAddress(publicKey);
    const address = encodeAddress(digest);

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [falconKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(1);

    const added = accountsOf(accountsStore)[0];
    expect(added.address).toBe(address);
    expect(added.address).toHaveLength(58);
    expect(added.metadata?.keyId).toBe("falcon-key-1");
    expect(added.metadata?.keyType).toBe("falcon-1024");
    expect(added.metadata?.pqScheme).toBe(PQ_SCHEME_FALCON1024);
    expect(added.metadata?.pqSalt).toBe(salt);
  });

  it("removes the falcon account when the falcon key is removed", async () => {
    const publicKey = new Uint8Array(1793).fill(5);
    const falconKey = { id: "falcon-key-2", type: "falcon-1024", publicKey } as unknown as Key;
    const address = encodeAddress(canonicalPQAddress(publicKey).address);

    const accountsStore = makeAccountsStore([
      { type: "algorand-account", address, metadata: { keyId: "falcon-key-2" } } as any,
    ]);
    const keyStore = new Store<KeyStoreState>({ keys: [falconKey], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore).find((a) => a.address === address)).toBeUndefined();
  });

  it("does not add an account for a key without a public key", async () => {
    const keyWithoutPublicKey = { id: "no-pk", type: "ed25519" } as unknown as Key;
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [keyWithoutPublicKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(0);
  });

  it("does not add an account for an unsupported key type", async () => {
    const unsupportedKey = {
      id: "future-key",
      type: "hybrid-lsig",
      publicKey: new Uint8Array(32).fill(9),
    } as unknown as Key;
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [unsupportedKey], status: "idle" }));
    await flushAsync();

    expect(accountsOf(accountsStore)).toHaveLength(0);
  });
});

describe("AlgorandSubscriber behavior", () => {
  const mockCreateSubscriberWithWatchlist = vi.mocked(createSubscriberWithWatchlist) as any;
  const mockGetAlgorandBalances = vi.mocked(getAlgorandBalances) as any;

  beforeEach(() => {
    mockCreateSubscriberWithWatchlist.mockReset();
    mockGetAlgorandBalances.mockReset();
    mockGetAlgorandBalances.mockResolvedValue({ balance: 1000n, assets: [] });
  });

  it("starts the subscriber after an algorand account is added", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    const mockStart = vi.fn();
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], _cb: any) => ({
        start: mockStart,
        stop: vi.fn(),
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
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [nonEdKey], status: "idle" }));
    await flushAsync();

    expect(createSubscriberWithWatchlist).not.toHaveBeenCalled();
  });

  it("updates the native ALGO balance when a balance change is detected", async () => {
    const mockKey = await getMockKey("key-1");
    const algorandAddress = encodeAddress(mockKey.publicKey!);

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { start: vi.fn(), stop: vi.fn(), watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Simulate a native ALGO balance change of +500n
    onBalanceChange!(algorandAddress, 0n, 500n);

    const account = accountsOf(accountsStore).find((a) => a.address === algorandAddress)!;
    expect(account.balance).toBe(1500n);
  });

  it("updates an ASA balance when a balance change is detected for that asset", async () => {
    const mockKey = await getMockKey("key-1");
    const algorandAddress = encodeAddress(mockKey.publicKey!);

    mockGetAlgorandBalances.mockResolvedValueOnce({
      balance: 1000n,
      assets: [{ id: "12345", name: "TestToken", type: "asa", balance: 200n, metadata: {} }],
    });

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { start: vi.fn(), stop: vi.fn(), watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Simulate an ASA 12345 balance change of +100n
    onBalanceChange!(algorandAddress, 12345n, 100n);

    const account = accountsOf(accountsStore).find((a) => a.address === algorandAddress)!;
    const asset = account.assets!.find((a) => a.id === "12345")!;
    expect(asset.balance).toBe(300n);
  });

  it("ignores balance changes for unrecognised addresses", async () => {
    const mockKey = await getMockKey("key-1");
    const algorandAddress = encodeAddress(mockKey.publicKey!);

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    let onBalanceChange: (address: string, assetId: bigint, amount: bigint) => void;
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], cb: any) => {
        onBalanceChange = cb;
        return { start: vi.fn(), stop: vi.fn(), watchlist: _addresses };
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();

    // Fire callback for a completely different address
    onBalanceChange!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 0n, 999n);

    const account = accountsOf(accountsStore).find((a) => a.address === algorandAddress)!;
    expect(account.balance).toBe(1000n); // unchanged
  });

  it("stops the old subscriber and starts a new one when a second key is added", async () => {
    const mockKey1 = await getMockKey("key-1");
    const mockKey2 = await getMockKey("key-2");

    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    const subscribers: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], _cb: any) => {
        const sub = { start: vi.fn(), stop: vi.fn(), watchlist: _addresses };
        subscribers.push(sub);
        return sub;
      },
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    // First key: first subscriber created
    keyStore.setState((s) => ({ ...s, keys: [mockKey1], status: "idle" }));
    await flushAsync();

    expect(subscribers).toHaveLength(1);
    expect(subscribers[0].start).toHaveBeenCalledTimes(1);

    // Second key added: first subscriber stopped, new one started
    keyStore.setState((s) => ({ ...s, keys: [mockKey1, mockKey2], status: "idle" }));
    await flushAsync();

    expect(subscribers[0].stop).toHaveBeenCalledWith("updating watchlist");
    expect(subscribers).toHaveLength(2);
    expect(subscribers[1].start).toHaveBeenCalledTimes(1);
  });

  it("stops the subscriber when the account store has zero algorand accounts", async () => {
    const mockKey = await getMockKey("key-1");
    const accountsStore = makeAccountsStore();
    const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" } as any);
    const provider = makeProvider();

    const mockStart = vi.fn();
    const mockStop = vi.fn();
    mockCreateSubscriberWithWatchlist.mockImplementation(
      (_client: any, _addresses: string[], _cb: any) => ({
        start: mockStart,
        stop: mockStop,
        watchlist: _addresses,
      }),
    );

    WithAlgorandAccounts(provider as any, makeOptions(accountsStore, keyStore) as any);

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "idle" }));
    await flushAsync();
    expect(mockStart).toHaveBeenCalledTimes(1);

    accountsStore.setState((s) => ({
      ...s,
      wallets: {},
      activeWallet: null,
    }));
    await flushAsync();

    expect(mockStop).toHaveBeenCalledWith("no algorand accounts");
  });
});
