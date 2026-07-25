import {
  type KeyStoreState,
  type SubtleShim,
  tagShim,
  XHD_ALGORITHM,
  type XHDBinding,
  withSubtleXHD,
} from "@algorandfoundation/keystore-core";
import { KeyContext, XHDWalletAPI, fromSeed } from "@algorandfoundation/xhd-wallet-api";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import { describe, expect, it, vi } from "vitest";

import { WithKeyStore } from "./extension.ts";
import type { KeychainStorage } from "./storage/driver.ts";
import type { ReactKeystoreOptions } from "./types.ts";

const message = new TextEncoder().encode("the quick brown fox");
// The setup file (see vitest.config.ts) points global.crypto at Node webcrypto,
// standing in for react-native-quick-crypto's subtle (Ed25519 / ECDSA / AES-GCM).
const subtle = globalThis.crypto.subtle;

const api = new XHDWalletAPI();
const xhd: XHDBinding = {
  fromSeed: (seed) => fromSeed(Buffer.from(seed)),
  deriveKey: (rootKey, bip44Path, isPrivate, derivationType) =>
    api.deriveKey(rootKey, bip44Path, isPrivate, derivationType),
  rawSign: (rootKey, bip44Path, data, derivationType) =>
    // @ts-expect-error accessing the private rawSign to build the binding
    api.rawSign(rootKey, bip44Path, data, derivationType),
  verifyWithPublicKey: (signature, msg, publicKey) =>
    api.verifyWithPublicKey(signature, msg, publicKey),
  ecdh: (rootKey, bip44Path, otherPartyPub, meFirst, derivationType) =>
    api.ECDH(
      rootKey,
      bip44Path[1] === 0x8000_011b ? KeyContext.Address : KeyContext.Identity,
      (bip44Path[2] ?? 0x8000_0000) & 0x7fff_ffff,
      (bip44Path[4] ?? 0) & 0x7fff_ffff,
      otherPartyPub,
      meFirst,
      derivationType,
    ),
};

const shims: SubtleShim[] = [tagShim(XHD_ALGORITHM, (h) => withSubtleXHD(h, xhd))];

/** A fresh in-memory MMKV-style store per test (real Keychain master is mocked). */
function memoryStorage(): KeychainStorage {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    getAllKeys: () => [...map.keys()],
  };
}

/**
 * Builds the extension over the shared React Native engine, matching the
 * Provider/Extensions pattern: the state store, hooks and platform bindings all
 * arrive through `options.keystore`.
 */
function createTestSetup() {
  const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
  const hooks = new Hook.Collection<any>();
  const storage = memoryStorage();
  const options: ReactKeystoreOptions = {
    keystore: { store, hooks, subtle, shims, storage },
  };
  const provider = { log: { debug: vi.fn() } } as any;
  const extension = WithKeyStore(provider, options);
  return { store, hooks, storage, extension };
}

describe("WithKeyStore Extension", () => {
  it("initializes reactive properties and exposes the engine + hooks", () => {
    const { extension, hooks } = createTestSetup();
    expect(extension.keys).toEqual([]);
    expect(extension.status).toBe("idle");
    expect(extension.key.store).toBeDefined();
    // The extension is the single source of the API and threads its hooks in.
    expect(extension.key.store.hooks).toBe(hooks);
  });

  it("reflects reactive store changes in keys and status", () => {
    const { extension, store } = createTestSetup();
    store.setState((s) => ({ ...s, status: "busy", keys: [{ id: "test" } as any] }));
    expect(extension.status).toBe("busy");
    expect(extension.keys).toHaveLength(1);
    expect(extension.keys[0].id).toBe("test");
  });

  it("exposes the keystore capabilities (host + shim) via `algorithms`", async () => {
    const { extension } = createTestSetup();
    await extension.key.store.ready;
    // The tagged XHD shim surfaces as a shim capability, alongside the baseline
    // host algorithms provided by the host Subtle.
    expect(extension.algorithms).toEqual(
      expect.arrayContaining([
        { algorithm: "BIP32-Ed25519", source: "shim" },
        { algorithm: "Ed25519", source: "host" },
      ]),
    );
  });

  it("runs the HD flow through the engine and fires the generate/sign hooks", async () => {
    const { extension, hooks } = createTestSetup();
    const generateBefore = vi.fn();
    const signBefore = vi.fn();
    hooks.before("generate", generateBefore);
    hooks.before("sign", signBefore);

    const seedId = await extension.key.store.importSeed!(new Uint8Array(32).fill(1));
    const rootId = await extension.key.store.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const acctId = await extension.key.store.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");

    const signature = await extension.key.store.sign(acctId, message);
    expect(signature.byteLength).toBe(64);
    expect(await extension.key.store.verify(acctId, message, signature)).toBe(true);
    expect(generateBefore).toHaveBeenCalled();
    expect(signBefore).toHaveBeenCalled();
    expect(extension.keys.map((k) => k.id).sort()).toEqual([acctId, rootId, seedId].sort());
  });

  it("removes a key and fires the remove hook", async () => {
    const { extension, hooks } = createTestSetup();
    const removeBefore = vi.fn();
    hooks.before("remove", removeBefore);

    const id = await extension.key.store.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(extension.keys.some((k) => k.id === id)).toBe(true);

    await extension.key.store.remove(id);
    expect(extension.keys.some((k) => k.id === id)).toBe(false);
    expect(removeBefore).toHaveBeenCalled();
  });

  it("clears all keys and fires the clear hook", async () => {
    const { extension, hooks } = createTestSetup();
    const clearBefore = vi.fn();
    hooks.before("clear", clearBefore);

    await extension.key.store.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(extension.keys.length).toBe(1);

    await extension.key.store.clear!();
    expect(extension.keys.length).toBe(0);
    expect(clearBefore).toHaveBeenCalled();
  });

  it("encrypts and decrypts through the engine", async () => {
    const { extension } = createTestSetup();
    const id = await extension.key.store.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const data = new TextEncoder().encode("secret message");
    const encrypted = await extension.key.store.encryptWithKey!(id, data);
    expect(new Uint8Array(encrypted)).not.toEqual(data);
    const decrypted = await extension.key.store.decryptWithKey!(id, encrypted);
    expect(new Uint8Array(decrypted)).toEqual(data);
  });

  it("batch signs through the engine and fires the batchSign hook", async () => {
    const { extension, hooks } = createTestSetup();
    const batchBefore = vi.fn();
    hooks.before("batchSign", batchBefore);

    const seedId = await extension.key.store.importSeed!(new Uint8Array(32).fill(2));
    const rootId = await extension.key.store.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const id1 = await extension.key.store.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const id2 = await extension.key.store.deriveFromSeed!(rootId, "m/44'/283'/0'/0/1");

    const signatures = await extension.key.store.batchSign!(
      [id1, id2],
      [new TextEncoder().encode("msg1"), new TextEncoder().encode("msg2")],
    );
    expect(signatures).toHaveLength(2);
    expect(
      await extension.key.store.verify(id1, new TextEncoder().encode("msg1"), signatures[0]!),
    ).toBe(true);
    expect(batchBefore).toHaveBeenCalled();
  });
});
