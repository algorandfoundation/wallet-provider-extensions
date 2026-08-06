import { DeterministicP256 } from "@algorandfoundation/dp256";
import {
  type DP256Binding,
  type KeyStoreState,
  type SubtleShim,
  type XHDBinding,
  withSubtleDP256,
  withSubtleXHD,
} from "@algorandfoundation/keystore-core";
import { KeyContext, XHDWalletAPI, fromSeed } from "@algorandfoundation/xhd-wallet-api";
import { Store } from "@tanstack/store";
import * as Keychain from "react-native-keychain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReactNativeKeyStore, type ReactNativeKeyStore } from "./engine.ts";
import {
  type KeychainStorage,
  migrateLegacyPasskeys,
  PASSKEY_MIGRATION_NEEDED,
} from "./storage/driver.ts";

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

const dp256api = new DeterministicP256();
const dp256: DP256Binding = {
  genDerivedMainKey: (entropy, salt, iterationCount, keyLengthBytes) =>
    dp256api.genDerivedMainKey(entropy, salt, iterationCount, keyLengthBytes),
  genDomainSpecificKeyPair: (mainKey, origin, userHandle, counter) =>
    dp256api.genDomainSpecificKeyPair(mainKey, origin, userHandle, counter),
  signWithDomainSpecificKeyPair: (privateKey, payload) =>
    dp256api.signWithDomainSpecificKeyPair(privateKey, payload),
  getPurePKBytes: (privateKey) => dp256api.getPurePKBytes(privateKey),
};

const shims: SubtleShim[] = [(h) => withSubtleXHD(h, xhd), (h) => withSubtleDP256(h, dp256)];

/** A fresh in-memory MMKV-style store per test (real Keychain master is mocked). */
function memoryStorage(): KeychainStorage & { entries(): [string, string][] } {
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
    entries: () => [...map.entries()],
  };
}

describe("createReactNativeKeyStore", () => {
  let store: Store<KeyStoreState>;
  let storage: ReturnType<typeof memoryStorage>;
  let keystore: ReactNativeKeyStore;

  beforeEach(async () => {
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    storage = memoryStorage();
    keystore = createReactNativeKeyStore({ store, subtle, shims, storage });
    await keystore.ready;
  });

  it("stores a standard Ed25519 key sealed in MMKV and signs/verifies", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.metadata?.storage).toBe("bytes");
    // Material is present under the material prefix and metadata under its own.
    expect(storage.getString(`m/${id}`)).toBeDefined();
    expect(storage.getString(`k/${id}`)).toBeDefined();

    const signature = await keystore.sign(id, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("runs the HD Algorand flow: seed → root → derived account → sign/verify", async () => {
    const seed = new Uint8Array(32).fill(7);
    const seedId = await keystore.importSeed!(seed);
    expect(store.state.keys.find((k) => k.id === seedId)?.type).toBe("seed");

    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    expect(store.state.keys.find((k) => k.id === rootId)?.type).toBe("hd-root-key");

    const acctId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const account = store.state.keys.find((k) => k.id === acctId);
    expect(account?.type).toBe("hd-derived-ed25519");
    expect(account?.publicKey).toBeInstanceOf(Uint8Array);

    const signature = await keystore.sign(acctId, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(acctId, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(acctId, tampered, signature)).toBe(false);
  });

  it("never persists private material as plaintext (encrypted at rest)", async () => {
    const seed = new Uint8Array(32).fill(3);
    const seedId = await keystore.importSeed!(seed);
    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });

    // The known root/seed plaintext must not appear in any stored value.
    const plaintextRoot = fromSeed(Buffer.from(seed));
    const rootHex = Buffer.from(plaintextRoot).toString("hex");
    const seedHex = Buffer.from(seed).toString("hex");
    for (const [, value] of storage.entries()) {
      const hex = Buffer.from(value, "utf8").toString("hex");
      expect(hex.includes(rootHex)).toBe(false);
      expect(hex.includes(seedHex)).toBe(false);
    }

    const meta = store.state.keys.find((k) => k.id === rootId);
    expect((meta as unknown as Record<string, unknown>).privateKey).toBeUndefined();
  });

  it("rehydrates metadata from storage on reopen and can still sign", async () => {
    const seed = new Uint8Array(32).fill(5);
    const seedId = await keystore.importSeed!(seed);
    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const acctId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const signature = await keystore.sign(acctId, message);

    // Reopen with a fresh store + engine against the same MMKV + Keychain master.
    const store2 = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const keystore2 = createReactNativeKeyStore({ store: store2, subtle, shims, storage });
    await keystore2.ready;
    expect(store2.state.keys.map((k) => k.id).sort()).toEqual([acctId, rootId, seedId].sort());
    expect(await keystore2.verify(acctId, message, signature)).toBe(true);
    const signature2 = await keystore2.sign(acctId, message);
    expect(await keystore2.verify(acctId, message, signature2)).toBe(true);
  });

  it("runs the passkey flow: entropy → dp256 main → domain key → sign/verify", async () => {
    const mainId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "P256",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { seed: new Uint8Array(16).fill(9), iterationCount: 32 },
    });
    const mainMeta = store.state.keys.find((k) => k.id === mainId);
    expect(mainMeta?.type).toBe("hd-root-key");
    expect(mainMeta?.metadata?.scheme).toBe("pbkdf2-p256");
    expect(storage.getString(`m/${mainId}`)).toBeDefined();

    const passkeyId = await keystore.deriveDomainKey!(mainId, {
      algorithm: "P256",
      origin: "https://example.com",
      userHandle: "user-123",
    });
    const passkeyMeta = store.state.keys.find((k) => k.id === passkeyId);
    expect(passkeyMeta?.type).toBe("hd-derived-p256");
    expect(passkeyMeta?.metadata?.scheme).toBe("pbkdf2-p256");
    expect(passkeyMeta?.metadata?.origin).toBe("https://example.com");
    // The domain key is metadata-only; no sealed material is persisted for it.
    expect(storage.getString(`m/${passkeyId}`)).toBeUndefined();

    const signature = await keystore.sign(passkeyId, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(passkeyId, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(passkeyId, tampered, signature)).toBe(false);
  });

  it("removes a key from both storage and the reactive store", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(store.state.keys.some((k) => k.id === id)).toBe(true);
    expect(storage.getString(`m/${id}`)).toBeDefined();

    await keystore.remove(id);
    expect(store.state.keys.some((k) => k.id === id)).toBe(false);
    expect(storage.getString(`m/${id}`)).toBeUndefined();
    expect(storage.getString(`k/${id}`)).toBeUndefined();
  });
});

describe("operation tagging", () => {
  let store: Store<KeyStoreState>;
  let storage: ReturnType<typeof memoryStorage>;

  /** Titles seen by the mocked Keychain reads, in call order. */
  function readPromptTitles(): (string | undefined)[] {
    return vi
      .mocked(Keychain.getGenericPassword)
      .mock.calls.map(
        ([options]) => options?.authenticationPrompt as { title?: string } | undefined,
      )
      .map((prompt) => prompt?.title);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    storage = memoryStorage();
  });

  it("gives the formatter the operation and keyId of each call", async () => {
    const seen: { operation: string; keyId?: string }[] = [];
    const keystore = createReactNativeKeyStore({
      store,
      subtle,
      shims,
      storage,
      authentication: {
        resolvePrompt: ({ operation, keyId }) => {
          seen.push({ operation, keyId });
          return `Prompt for ${operation}`;
        },
      },
    });
    await keystore.ready;

    const seedId = await keystore.importSeed!(new Uint8Array(32).fill(7));
    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const acctId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    await keystore.sign(acctId, message);

    expect(seen).toContainEqual({ operation: "importSeed", keyId: undefined });
    expect(seen).toContainEqual({ operation: "generate", keyId: undefined });
    expect(seen).toContainEqual({ operation: "deriveFromSeed", keyId: rootId });
    expect(seen).toContainEqual({ operation: "sign", keyId: acctId });

    // The formatter's wording reaches the Keychain, not just the context.
    expect(readPromptTitles()).toContain("Prompt for sign");
    expect(readPromptTitles()).toContain("Prompt for deriveFromSeed");
  });

  it("lets the formatter name the key from the reactive store's metadata", async () => {
    const keystore = createReactNativeKeyStore({
      store,
      subtle,
      shims,
      storage,
      authentication: {
        resolvePrompt: ({ operation, key }) =>
          operation === "sign" && key ? `Sign with your ${key.type} key` : undefined,
      },
    });
    await keystore.ready;

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    await keystore.sign(id, message);

    expect(readPromptTitles()).toContain("Sign with your ed25519 key");
  });

  it("lets a per-call prompt win over the app-wide policy", async () => {
    const keystore = createReactNativeKeyStore({
      store,
      subtle,
      shims,
      storage,
      authentication: { prompt: "App-wide", prompts: { sign: "Map wording" } },
    });
    await keystore.ready;

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    await keystore.sign(id, message, undefined, { prompt: "Just this once" });

    expect(readPromptTitles().at(-1)).toBe("Just this once");
  });

  it("never mutates the context object the caller passed in", async () => {
    const keystore = createReactNativeKeyStore({ store, subtle, shims, storage });
    await keystore.ready;

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });

    const ctx = { biometrics: true };
    await keystore.sign(id, message, undefined, ctx);

    expect(ctx).toEqual({ biometrics: true });
  });

  it("performs one Keychain read per material operation (no in-memory cache)", async () => {
    const keystore = createReactNativeKeyStore({ store, subtle, shims, storage });
    await keystore.ready;

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const before = vi.mocked(Keychain.getGenericPassword).mock.calls.length;
    await keystore.sign(id, message);
    await keystore.sign(id, message);

    expect(vi.mocked(Keychain.getGenericPassword).mock.calls.length).toBe(before + 2);
  });

  it("leaves verify context-free and passes non-function properties through", async () => {
    const keystore = createReactNativeKeyStore({ store, subtle, shims, storage });
    await keystore.ready;

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const signature = await keystore.sign(id, message);
    const before = vi.mocked(Keychain.getGenericPassword).mock.calls.length;

    expect(await keystore.verify(id, message, signature)).toBe(true);
    expect(vi.mocked(Keychain.getGenericPassword).mock.calls.length).toBe(before);
    expect(keystore.ready).toBeInstanceOf(Promise);
  });
});

describe("migrateLegacyPasskeys", () => {
  /** Seeds a legacy passkey metadata record (pre-dp256-split, no `scheme`). */
  function seedLegacyPasskey(storage: KeychainStorage, id: string): void {
    storage.set(
      `k/${id}`,
      JSON.stringify({
        id,
        type: "hd-derived-p256",
        algorithm: "P256",
        extractable: false,
        keyUsages: ["sign", "verify"],
        metadata: {
          storage: "none",
          origin: "https://example.com",
          userHandle: "user-123",
          counter: 0,
          parentKeyId: "xhd-root-1",
        },
        version: 1,
      }),
    );
  }

  it("flags a legacy passkey needs-migration in place, without copying", () => {
    const storage = memoryStorage();
    seedLegacyPasskey(storage, "pk1");

    const flagged = migrateLegacyPasskeys(storage);
    expect(flagged).toHaveLength(1);

    const record = flagged[0]!;
    // The same instance is flagged in place: same id, no copy is created.
    expect(record.id).toBe("pk1");
    expect(record.type).toBe("hd-derived-p256");
    expect(record.metadata?.migration).toBe(PASSKEY_MIGRATION_NEEDED);
    // The domain descriptor is preserved so the app can recreate the passkey.
    expect(record.metadata?.origin).toBe("https://example.com");
    expect(record.metadata?.userHandle).toBe("user-123");

    // The original record is updated in place and no copy key is written.
    const stored = JSON.parse(storage.getString("k/pk1") as string);
    expect(stored.metadata.migration).toBe(PASSKEY_MIGRATION_NEEDED);
    expect(storage.getString("k/pk1:needs-migration")).toBeUndefined();
  });

  it("is idempotent and never re-migrates a marker or a new-scheme passkey", () => {
    const storage = memoryStorage();
    seedLegacyPasskey(storage, "pk1");
    // A new-scheme passkey must be ignored entirely.
    storage.set(
      "k/pk2",
      JSON.stringify({
        id: "pk2",
        type: "hd-derived-p256",
        algorithm: "P256",
        extractable: false,
        keyUsages: ["sign", "verify"],
        metadata: { storage: "none", scheme: "pbkdf2-p256", origin: "o", userHandle: "u" },
        version: 1,
      }),
    );

    expect(migrateLegacyPasskeys(storage)).toHaveLength(1);
    // Re-running finds nothing new (the record is already flagged in place).
    expect(migrateLegacyPasskeys(storage)).toHaveLength(0);
    // pk2 (new scheme) is never flagged.
    const pk2 = JSON.parse(storage.getString("k/pk2") as string);
    expect(pk2.metadata.migration).toBeUndefined();
  });

  it("surfaces migration markers in the reactive store on startup", async () => {
    const storage = memoryStorage();
    seedLegacyPasskey(storage, "pk1");

    const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const keystore = createReactNativeKeyStore({ store, subtle, shims, storage });
    await keystore.ready;

    const marker = store.state.keys.find((k) => k.id === "pk1");
    expect(marker?.metadata?.migration).toBe(PASSKEY_MIGRATION_NEEDED);
  });
});
