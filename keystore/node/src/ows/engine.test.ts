import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOwsKeyStore } from "./engine.ts";
import { OwsError, OwsUnsupportedOperationError } from "./errors.ts";
import type { OwsBinding, OwsKeyStore, OwsWalletInfo } from "./types.ts";

const EVM_CHAIN = "eip155:1";
const SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const MNEMONIC =
  "goose puzzle decorate much stable beach lecture cushion nominee sadness pupil dawn";

/** A wallet as the OWS surfaces report it: one account per supported chain. */
function wallet(id: string, name: string): OwsWalletInfo {
  return {
    id,
    name,
    createdAt: "2026-03-22T00:00:00Z",
    accounts: [
      { chainId: EVM_CHAIN, address: `0x${id}`, derivationPath: "m/44'/60'/0'/0/0" },
      { chainId: SOLANA_CHAIN, address: `sol-${id}`, derivationPath: "m/44'/501'/0'/0'" },
    ],
  };
}

/** An in-memory OWS vault standing in for a real access layer. */
function memoryBinding(): OwsBinding & { calls: Array<{ method: string; request: unknown }> } {
  const wallets = new Map<string, OwsWalletInfo>([["wallet-a", wallet("wallet-a", "treasury")]]);
  const calls: Array<{ method: string; request: unknown }> = [];
  const record = <T>(method: string, request: unknown, value: T): T => {
    calls.push({ method, request });
    return value;
  };
  const find = (nameOrId: string): OwsWalletInfo => {
    const match = [...wallets.values()].find((w) => w.id === nameOrId || w.name === nameOrId);
    if (!match) throw new Error(`wallet not found: ${nameOrId}`);
    return match;
  };

  return {
    kind: "memory",
    calls,
    listWallets: async () => [...wallets.values()],
    getWallet: async (nameOrId) => find(nameOrId),
    createWallet: async (request) => {
      const created = wallet(`wallet-${wallets.size + 1}`, request.name);
      wallets.set(created.id, created);
      return record("createWallet", request, created);
    },
    importMnemonic: async (request) => {
      const created = wallet(`wallet-${wallets.size + 1}`, request.name);
      wallets.set(created.id, created);
      return record("importMnemonic", request, created);
    },
    importPrivateKey: async (request) => {
      const created = wallet(`wallet-${wallets.size + 1}`, request.name);
      wallets.set(created.id, created);
      return record("importPrivateKey", request, created);
    },
    deleteWallet: async (nameOrId) => {
      wallets.delete(find(nameOrId).id);
      calls.push({ method: "deleteWallet", request: nameOrId });
    },
    exportWallet: async (nameOrId, passphrase) =>
      record("exportWallet", { nameOrId, passphrase }, MNEMONIC),
    signMessage: async (request) =>
      record("signMessage", request, { signature: "0xAABB", recoveryId: 1 }),
    signTransaction: async (request) => record("signTransaction", request, { signature: "ccdd" }),
    signHash: async (request) => record("signHash", request, { signature: "eeff" }),
  };
}

describe("createOwsKeyStore", () => {
  let store: Store<KeyStoreState>;
  let binding: ReturnType<typeof memoryBinding>;
  let keystore: OwsKeyStore;

  beforeEach(async () => {
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    binding = memoryBinding();
    keystore = createOwsKeyStore({ store, binding, passphrase: "ows_key_default" });
    await keystore.ready;
  });

  it("hydrates the reactive store with one key per OWS account", () => {
    expect(store.state.keys.map((key) => key.id)).toEqual([
      `ows/wallet-a/${EVM_CHAIN}`,
      `ows/wallet-a/${SOLANA_CHAIN}`,
    ]);
    const [evm, solana] = store.state.keys;
    expect(evm).toMatchObject({
      type: "ecc",
      algorithm: "ES256K",
      extractable: false,
      metadata: { chain: "evm", curve: "secp256k1", address: "0xwallet-a", walletName: "treasury" },
    });
    expect(solana).toMatchObject({ type: "ed25519", algorithm: "EdDSA" });
    expect(store.state.algorithms).toEqual([
      { algorithm: "EdDSA", source: "host" },
      { algorithm: "ES256K", source: "host" },
    ]);
    expect(store.state.status).toBe("idle");
  });

  it("never exposes secret material in the projected metadata", () => {
    for (const key of store.state.keys) {
      expect(key).not.toHaveProperty("privateKey");
      expect(JSON.stringify(key)).not.toContain(MNEMONIC);
    }
  });

  it("generates a new OWS wallet and returns the requested chain account", async () => {
    const id = await keystore.generate({
      type: "ecc",
      algorithm: "ES256K",
      extractable: false,
      keyUsages: ["sign"],
      params: { name: "agent-treasury", words: 24, chain: "solana" },
    });

    expect(id).toBe(`ows/wallet-2/${SOLANA_CHAIN}`);
    expect(binding.calls[0]).toEqual({
      method: "createWallet",
      request: { name: "agent-treasury", words: 24, passphrase: "ows_key_default" },
    });
    expect(store.state.keys).toHaveLength(4);
  });

  it("imports a mnemonic and a raw private key through the matching OWS operation", async () => {
    await keystore.import(MNEMONIC);
    expect(binding.calls.at(-1)).toMatchObject({
      method: "importMnemonic",
      request: { mnemonic: MNEMONIC },
    });

    await keystore.import(new Uint8Array([0x4c, 0x08, 0x83, 0xa6]));
    expect(binding.calls.at(-1)).toMatchObject({
      method: "importPrivateKey",
      request: { privateKeyHex: "4c0883a6" },
    });
  });

  it("signs a message hex-encoded by default and appends the recovery id", async () => {
    const id = `ows/wallet-a/${EVM_CHAIN}`;
    const signature = await keystore.sign(id, new Uint8Array([1, 2, 3]));

    expect(binding.calls.at(-1)).toEqual({
      method: "signMessage",
      request: {
        wallet: "wallet-a",
        chain: "evm",
        passphrase: "ows_key_default",
        message: "010203",
        encoding: "hex",
      },
    });
    expect([...signature]).toEqual([0xaa, 0xbb, 0x01]);
  });

  it("signs utf8 messages, transactions and digests through the right operation", async () => {
    const id = `ows/wallet-a/${EVM_CHAIN}`;

    await keystore.sign(id, new TextEncoder().encode("hello"), "message", { encoding: "utf8" });
    expect(binding.calls.at(-1)).toMatchObject({
      method: "signMessage",
      request: { message: "hello", encoding: "utf8" },
    });

    await keystore.sign(id, new Uint8Array([0x02, 0xf8]), "tx");
    expect(binding.calls.at(-1)).toMatchObject({
      method: "signTransaction",
      request: { transactionHex: "02f8" },
    });

    const digest = new Uint8Array(32).fill(0x11);
    await keystore.sign(id, digest, "hash");
    expect(binding.calls.at(-1)).toMatchObject({
      method: "signHash",
      request: { hashHex: "11".repeat(32) },
    });

    await expect(keystore.sign(id, new Uint8Array(31), "hash")).rejects.toThrow(/32-byte digest/);
  });

  it("lets a per-operation credential override the default one", async () => {
    await keystore.sign(`ows/wallet-a/${EVM_CHAIN}`, new Uint8Array([1]), undefined, {
      passphrase: "ows_key_agent",
      index: 3,
    });

    expect(binding.calls.at(-1)).toMatchObject({
      request: { passphrase: "ows_key_agent", index: 3 },
    });
  });

  it("surfaces an OWS denial instead of rewriting it into a success", async () => {
    binding.signMessage = () =>
      Promise.reject(new Error("error: policy denied: chain eip155:1 not in allowlist"));

    const failure = await keystore
      .sign(`ows/wallet-a/${EVM_CHAIN}`, new Uint8Array([1]))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OwsError);
    expect((failure as OwsError).code).toBe("POLICY_DENIED");
    expect(store.state.status).toBe("idle");
  });

  it("maps an unknown wallet onto KeyNotFoundError", async () => {
    await expect(keystore.sign("ows/missing/eip155:1", new Uint8Array([1]))).rejects.toThrow(
      /Key not found/,
    );
  });

  it("refuses to export unless the caller explicitly opted in", async () => {
    await expect(keystore.export(`ows/wallet-a/${EVM_CHAIN}`)).rejects.toBeInstanceOf(
      OwsUnsupportedOperationError,
    );

    const exporting = createOwsKeyStore({ store, binding, allowExport: true });
    await exporting.ready;
    const exported = await exporting.export(`ows/wallet-a/${EVM_CHAIN}`);
    expect(exported.metadata?.["mnemonic"]).toBe(MNEMONIC);
  });

  it("refuses to verify, since OWS exposes no verification operation", async () => {
    await expect(
      keystore.verify(`ows/wallet-a/${EVM_CHAIN}`, new Uint8Array([1]), new Uint8Array([2])),
    ).rejects.toBeInstanceOf(OwsUnsupportedOperationError);
  });

  it("removes the whole OWS wallet and re-reads the vault", async () => {
    await keystore.remove(`ows/wallet-a/${EVM_CHAIN}`);

    expect(binding.calls.at(-1)).toEqual({ method: "deleteWallet", request: "wallet-a" });
    expect(store.state.keys).toEqual([]);
  });

  it("clears every wallet in the vault", async () => {
    await keystore.generate({
      type: "ecc",
      algorithm: "ES256K",
      extractable: false,
      keyUsages: ["sign"],
    });
    await keystore.clear?.();

    expect(store.state.keys).toEqual([]);
  });

  it("intercepts operations with the bound hook collection", async () => {
    const hooks = new Hook.Collection();
    const before = vi.fn();
    const hooked = createOwsKeyStore({ store, binding, hooks });
    await hooked.ready;
    hooked.hooks?.before("sign", before);

    await hooked.sign(`ows/wallet-a/${EVM_CHAIN}`, new Uint8Array([1]));

    expect(before).toHaveBeenCalledOnce();
  });
});
