import { beforeAll, describe, expect, it, vi } from "vitest";
import { isKeystoreAccount, WithAccountsKeystore } from "./extension.ts";
import { base64 } from "@scure/base";
import type { Account, AccountStoreState } from "@algorandfoundation/accounts-store";
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
import type { KeystoreAccount } from "./types.ts";

const FIXED_SEED = new Uint8Array(64).fill(1);
const host = globalThis.crypto.subtle;

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
 * `Key` fixtures (with genuine derived public keys) through `createKeyStore`
 * rather than the deleted `generate*FromSeed` helpers.
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

describe("WithAccountsKeystore", () => {
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

  /** Derives a real `hd-derived-ed25519` address-context key via the XHD engine. */
  async function getMockKey(id: string): Promise<Key> {
    const index = Number.parseInt(id.replace("key-", ""), 10) || 0;
    const keyId = await keystoreEngine.deriveFromSeed!(rootId, `m/44'/283'/0'/0/${index}`, {
      id,
      algorithm: "EdDSA",
      metadata: { context: 0, account: 0, index },
    });
    return (await keystoreEngine.export(keyId)) as unknown as Key;
  }

  /** A deterministic, id-derived 32-byte seed for standalone ed25519 imports. */
  function ed25519SeedFor(id: string): Uint8Array {
    const seed = new Uint8Array(32);
    for (let i = 0; i < id.length; i += 1) {
      seed[i % 32] ^= id.charCodeAt(i) + i + 1;
    }
    return seed;
  }

  /** Imports a real standalone ed25519 key, linked to `parentKeyId` metadata. */
  async function getMockEd25519Key(id: string, parentKeyId = "seed-1"): Promise<Key> {
    const keyId = await keystoreEngine.import({
      id,
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      privateKey: ed25519SeedFor(id),
      metadata: { parentKeyId },
    });
    return (await keystoreEngine.export(keyId)) as unknown as Key;
  }

  it("should populate accounts from keystore keys in provider", async () => {
    const mockKey = await getMockKey("key-1");

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });
    const spySetState = vi.spyOn(accountStore, "setState");

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: {
        store: {
          addAccount: vi.fn(),
        },
      },
      key: {
        store: {
          hooks: {
            after: vi.fn(),
          },
        },
      },
    };

    const options = {
      accounts: {
        store: accountStore,
        keystore: { autoPopulate: true },
      },
      keystore: {
        store: keyStore,
      },
    };

    WithAccountsKeystore(provider as any, options as any);

    expect(spySetState).toHaveBeenCalled();
    expect(accountStore.state.accounts.length).toBe(1);
    const addedAccount: Account = accountStore.state.accounts[0];
    expect(isKeystoreAccount(addedAccount)).toBe(true);
    if (isKeystoreAccount(addedAccount)) {
      expect(addedAccount.address).toBe(base64.encode(mockKey.publicKey!));
      expect(addedAccount.metadata?.keyId).toBe(mockKey.id);
    }
  });

  it("should provide a sign method that calls keystore.sign", async () => {
    const mockKey = await getMockKey("key-1");
    const mockSign = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: {
        store: {
          setState: vi.fn(),
        },
      },
      key: {
        store: {
          sign: mockSign,
          hooks: {
            after: vi.fn(),
          },
        },
      },
    };

    const options = {
      accounts: {
        store: accountStore,
        keystore: { autoPopulate: true },
      },
      keystore: {
        store: keyStore,
      },
    };

    WithAccountsKeystore(provider as any, options as any);

    const addedAccount: Account = accountStore.state.accounts[0];
    if (!isKeystoreAccount(addedAccount)) {
      throw new Error("Expected account to be a KeystoreAccount");
    }

    const txns = [new Uint8Array([1, 2, 3])];
    const signedTxns = await addedAccount.sign(txns);

    expect(mockSign).toHaveBeenCalledWith(mockKey.id, txns[0]);
    expect(signedTxns[0]).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("should not add duplicate accounts if they already exist in account store", async () => {
    const mockKey = await getMockKey("key-1");
    const address = base64.encode(mockKey.publicKey!);

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [{ address, metadata: { keyId: mockKey.id } } as any],
    });
    const spySetState = vi.spyOn(accountStore, "setState");

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: {
        store: {
          setState: vi.fn(),
        },
      },
      key: {
        store: {
          hooks: {
            after: vi.fn(),
          },
        },
      },
    };

    const options = {
      accounts: {
        store: accountStore,
        keystore: { autoPopulate: true },
      },
      keystore: {
        store: keyStore,
      },
    };

    WithAccountsKeystore(provider as any, options as any);

    // Initial population check - should NOT call setState because account already exists
    expect(spySetState).not.toHaveBeenCalled();
  });

  it("should add missing accounts when keystore state updates", async () => {
    const mockKey1 = await getMockKey("key-1");
    const mockKey2 = await getMockKey("key-2");

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [
        { address: base64.encode(mockKey1.publicKey!), metadata: { keyId: mockKey1.id } } as any,
      ],
    });
    const spySetState = vi.spyOn(accountStore, "setState");

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey1],
      status: "idle",
    });

    const provider = {
      keys: [mockKey1],
      status: "idle",
      account: {
        store: {
          setState: vi.fn(),
        },
      },
      key: {
        store: {
          hooks: {
            after: vi.fn(),
          },
        },
      },
    };

    const options = {
      accounts: {
        store: accountStore,
        keystore: { autoPopulate: true },
      },
      keystore: {
        store: keyStore,
      },
    };

    WithAccountsKeystore(provider as any, options as any);

    // Initial population check
    expect(spySetState).not.toHaveBeenCalled();

    // Trigger subscribe with new key
    keyStore.setState((s) => ({
      ...s,
      status: "ready",
      keys: [mockKey1, mockKey2],
    }));

    // Wait for the async processUpdates
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spySetState).toHaveBeenCalledTimes(1);
    expect(accountStore.state.accounts.length).toBe(2);

    const addedAccount = accountStore.state.accounts.find(
      (a) => a.address === base64.encode(mockKey2.publicKey!),
    );
    expect(addedAccount).toBeDefined();
    expect(isKeystoreAccount(addedAccount!)).toBe(true);
    if (isKeystoreAccount(addedAccount!)) {
      expect(addedAccount.metadata?.keyId).toBe(mockKey2.id);
    }
  });

  it("should populate an account for a standalone ed25519 key", async () => {
    const mockKey = await getMockEd25519Key("ed-1");

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: { store: { addAccount: vi.fn() } },
      key: { store: { hooks: { after: vi.fn() } } },
    };

    const options = {
      accounts: { store: accountStore, keystore: { autoPopulate: true } },
      keystore: { store: keyStore },
    };

    WithAccountsKeystore(provider as any, options as any);

    expect(accountStore.state.accounts.length).toBe(1);
    const addedAccount: Account = accountStore.state.accounts[0];
    expect(isKeystoreAccount(addedAccount)).toBe(true);
    if (isKeystoreAccount(addedAccount)) {
      expect(addedAccount.address).toBe(base64.encode(mockKey.publicKey!));
      expect(addedAccount.metadata?.keyId).toBe(mockKey.id);
      expect(addedAccount.metadata?.parentKeyId).toBe("seed-1");
    }
  });

  it("should remove the account when a standalone ed25519 key is removed", async () => {
    const mockKey = await getMockEd25519Key("ed-1");
    const address = base64.encode(mockKey.publicKey!);

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });

    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: { store: { addAccount: vi.fn() } },
      key: { store: { hooks: { after: vi.fn() } } },
    };

    const options = {
      accounts: { store: accountStore, keystore: { autoPopulate: true } },
      keystore: { store: keyStore },
    };

    WithAccountsKeystore(provider as any, options as any);
    expect(accountStore.state.accounts.length).toBe(1);

    keyStore.setState((s) => ({ ...s, status: "ready", keys: [] }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(accountStore.state.accounts.find((a) => a.address === address)).toBeUndefined();
  });

  it("should propagate the seed's scheme onto a standalone ed25519 account", async () => {
    const seedKey = {
      id: "seed-1",
      type: "hd-seed",
      privateKey: FIXED_SEED,
      algorithm: "raw",
      extractable: true,
      metadata: { scheme: "bip39" },
    } as unknown as Key;
    const mockKey = await getMockEd25519Key("ed-1");

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });
    const keyStore = new Store<KeyStoreState>({
      keys: [seedKey, mockKey],
      status: "idle",
    });

    const provider = {
      keys: [seedKey, mockKey],
      status: "idle",
      account: { store: { addAccount: vi.fn() } },
      key: { store: { hooks: { after: vi.fn() } } },
    };
    const options = {
      accounts: { store: accountStore, keystore: { autoPopulate: true } },
      keystore: { store: keyStore },
    };

    WithAccountsKeystore(provider as any, options as any);

    const added = accountStore.state.accounts[0];
    expect(isKeystoreAccount(added)).toBe(true);
    if (isKeystoreAccount(added)) {
      expect(added.metadata?.seedScheme).toBe("bip39");
    }
  });

  it("should propagate the seed's scheme onto an XHD-derived ed25519 account", async () => {
    const seedKey = {
      id: "seed-1",
      type: "hd-seed",
      privateKey: FIXED_SEED,
      algorithm: "raw",
      extractable: true,
      metadata: { scheme: "algo25" },
    } as unknown as Key;
    const rootKey = {
      id: "root-1",
      type: "hd-root-key",
      metadata: { parentKeyId: "seed-1" },
    } as unknown as Key;
    // Build an XHD-derived child but rebind its parent to root-1 for the test.
    const child = await getMockKey("key-1");
    (child as any).metadata = {
      ...(child as any).metadata,
      parentKeyId: "root-1",
    };

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });
    const keyStore = new Store<KeyStoreState>({
      keys: [seedKey, rootKey, child],
      status: "idle",
    });

    const provider = {
      keys: [seedKey, rootKey, child],
      status: "idle",
      account: { store: { addAccount: vi.fn() } },
      key: { store: { hooks: { after: vi.fn() } } },
    };
    const options = {
      accounts: { store: accountStore, keystore: { autoPopulate: true } },
      keystore: { store: keyStore },
    };

    WithAccountsKeystore(provider as any, options as any);

    const added = accountStore.state.accounts.find((a) => a.metadata?.keyId === "key-1");
    expect(added).toBeDefined();
    if (added && isKeystoreAccount(added)) {
      expect(added.metadata?.seedScheme).toBe("algo25");
    }
  });

  it("should omit seedScheme when the seed has no scheme metadata", async () => {
    const mockKey = await getMockEd25519Key("ed-1");
    // No seed key in the store → resolver returns undefined.

    const accountStore = new Store<AccountStoreState<KeystoreAccount>>({
      accounts: [],
    });
    const keyStore = new Store<KeyStoreState>({
      keys: [mockKey],
      status: "idle",
    });

    const provider = {
      keys: [mockKey],
      status: "idle",
      account: { store: { addAccount: vi.fn() } },
      key: { store: { hooks: { after: vi.fn() } } },
    };
    const options = {
      accounts: { store: accountStore, keystore: { autoPopulate: true } },
      keystore: { store: keyStore },
    };

    WithAccountsKeystore(provider as any, options as any);

    const added = accountStore.state.accounts[0];
    expect(isKeystoreAccount(added)).toBe(true);
    if (isKeystoreAccount(added)) {
      expect(added.metadata?.seedScheme).toBeUndefined();
    }
  });
});
