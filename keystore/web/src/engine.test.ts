import "fake-indexeddb/auto";

import {
  type KeyStoreState,
  type SubtleShim,
  type XHDBinding,
  consumeKeyMaterial,
  createKeyHandle,
  withSubtleFalcon1024,
  withSubtleXHD,
} from "@algorandfoundation/keystore-core";
import { KeyContext, XHDWalletAPI, fromSeed, harden } from "@algorandfoundation/xhd-wallet-api";
import { Store } from "@tanstack/store";
import * as falcon from "falcon-1024";
import { beforeEach, describe, expect, it } from "vitest";
import { createWebKeyStore, type WebKeyStore } from "./engine.ts";
import { MATERIAL_STORE, openDatabase, type MaterialRecord } from "./storage/db.ts";

const message = new TextEncoder().encode("the quick brown fox");

// Adapter exposing the (otherwise private) rawSign of XHDWalletAPI, mirroring
// what a real platform binding provides. Same shape the core shim test uses.
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
  ecdh: (rootKey, bip44Path, otherPartyPub, meFirst, derivationType) => {
    const context = bip44Path[1] === harden(283) ? KeyContext.Address : KeyContext.Identity;
    const account = (bip44Path[2] ?? harden(0)) & 0x7fff_ffff;
    const keyIndex = (bip44Path[4] ?? 0) & 0x7fff_ffff;
    return api.ECDH(rootKey, context, account, keyIndex, otherPartyPub, meFirst, derivationType);
  },
};

let dbCounter = 0;

function newStore(): Store<KeyStoreState> {
  return new Store<KeyStoreState>({ keys: [], status: "idle" });
}

async function makeKeyStore(
  store: Store<KeyStoreState>,
  databaseName: string,
  extraShims: SubtleShim[] = [],
): Promise<WebKeyStore> {
  const shims: SubtleShim[] = [
    (h) => withSubtleXHD(h, xhd),
    (h) => withSubtleFalcon1024(h, falcon),
    ...extraShims,
  ];
  const keystore = createWebKeyStore({ store, shims, databaseName });
  await keystore.ready;
  return keystore;
}

describe("createWebKeyStore", () => {
  let store: Store<KeyStoreState>;
  let databaseName: string;
  let keystore: WebKeyStore;

  beforeEach(async () => {
    store = newStore();
    databaseName = `keystore-test-${dbCounter++}`;
    keystore = await makeKeyStore(store, databaseName);
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

    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, rootId);
    expect(record?.kind).toBe("bytes");

    // The known root plaintext must not appear anywhere in the ciphertext.
    const plaintextRoot = fromSeed(Buffer.from(seed));
    if (record?.kind === "bytes") {
      expect(record.ciphertext.length).toBeGreaterThan(0);
      expect(containsSubarray(record.ciphertext, plaintextRoot)).toBe(false);
    }
    // The reactive store metadata never carries private material.
    const meta = store.state.keys.find((k) => k.id === rootId);
    expect((meta as unknown as Record<string, unknown>).privateKey).toBeUndefined();
  });

  it("generates a seed-derived Falcon-1024 key and signs/verifies", async () => {
    const seed = new Uint8Array(48).fill(9);
    const id = await keystore.generate({
      type: "falcon-1024",
      algorithm: "Falcon-1024",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { seed },
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.algorithm).toBe("Falcon-1024");
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);

    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("generates a standard host Ed25519 key (stored as a non-extractable CryptoKey)", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
    expect(record?.kind).toBe("cryptokey");
    if (record?.kind === "cryptokey") {
      expect(record.privateKey.extractable).toBe(false);
    }

    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);
  });

  it("encrypts/decrypts natively with a non-extractable AES-GCM CryptoKey", async () => {
    const id = await keystore.generate({
      type: "secret-key",
      algorithm: "AES-GCM",
      extractable: false,
      keyUsages: ["encrypt", "decrypt"],
      params: { length: 256 },
    });
    // The key persists as a native CryptoKey — no byte material ever exists.
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
    expect(record?.kind).toBe("cryptokey");
    if (record?.kind === "cryptokey") {
      expect(record.privateKey.extractable).toBe(false);
    }

    const plaintext = new TextEncoder().encode("host-sealed payload");
    const ciphertext = await keystore.encryptWithKey!(id, plaintext);
    expect(ciphertext[0]).toBe(2);
    const decrypted = await keystore.decryptWithKey!(id, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("host-sealed payload");
  });

  it("encrypts/decrypts with a non-extractable ECDH CryptoKey via a self-agreement", async () => {
    const id = await keystore.generate({
      type: "ecc",
      algorithm: "ECDH",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { namedCurve: "P-256" },
    });
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
    expect(record?.kind).toBe("cryptokey");

    const plaintext = new TextEncoder().encode("agreement-sealed payload");
    const ciphertext = await keystore.encryptWithKey!(id, plaintext);
    expect(ciphertext[0]).toBe(2);
    const decrypted = await keystore.decryptWithKey!(id, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("agreement-sealed payload");
  });

  it("encrypts/decrypts with a deriveKey-only ECDH CryptoKey without surfacing bytes", async () => {
    const id = await keystore.generate({
      type: "ecc",
      algorithm: "ECDH",
      extractable: false,
      keyUsages: ["deriveKey"],
      params: { namedCurve: "P-256" },
    });
    const plaintext = new TextEncoder().encode("in-host agreement");
    const ciphertext = await keystore.encryptWithKey!(id, plaintext);
    const decrypted = await keystore.decryptWithKey!(id, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("in-host agreement");
  });

  it("seals to a third-party public key with HPKE using native ECDH CryptoKeys", async () => {
    const ecdhOptions = {
      type: "ecc",
      algorithm: "ECDH",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { namedCurve: "P-256" },
    } as const;
    const aliceId = await keystore.generate({ ...ecdhOptions, keyUsages: ["deriveBits"] });
    const bobId = await keystore.generate({ ...ecdhOptions, keyUsages: ["deriveBits"] });
    // The native branch mirrors the SPKI public bytes into the metadata so a
    // peer can be handed this key's public key.
    const bobPublic = store.state.keys.find((k) => k.id === bobId)!.publicKey!;
    expect(bobPublic).toBeInstanceOf(Uint8Array);

    const plaintext = new TextEncoder().encode("dear bob (native)");
    const sealed = await keystore.encryptWithKey!(aliceId, plaintext, {
      recipientPublicKey: bobPublic,
    });
    // Peer layout: [version=3 | suite=1 | senderPub(65) | enc(65) | ct].
    expect(sealed[0]).toBe(3);
    const opened = await keystore.decryptWithKey!(bobId, sealed);
    expect(new TextDecoder().decode(opened)).toBe("dear bob (native)");
    // Only the addressed recipient can open it — not even the sender.
    await expect(keystore.decryptWithKey!(aliceId, sealed)).rejects.toThrow();
  });

  it("refuses peer encryption for a deriveKey-only native ECDH CryptoKey", async () => {
    const senderId = await keystore.generate({
      type: "ecc",
      algorithm: "ECDH",
      extractable: false,
      keyUsages: ["deriveKey"],
      params: { namedCurve: "P-256" },
    });
    const recipientId = await keystore.generate({
      type: "ecc",
      algorithm: "ECDH",
      extractable: false,
      keyUsages: ["deriveBits"],
      params: { namedCurve: "P-256" },
    });
    const recipientPublicKey = store.state.keys.find((k) => k.id === recipientId)!.publicKey!;
    // HPKE concatenates raw DH outputs, which `deriveKey` alone cannot produce.
    await expect(
      keystore.encryptWithKey!(senderId, message, { recipientPublicKey }),
    ).rejects.toThrow(/deriveBits/);
  });

  it("refuses encryptWithKey for a signature-only native CryptoKey", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    // A non-extractable Ed25519 signing key can neither encrypt nor run a key
    // agreement — there is no secret path to an encryption key for it.
    await expect(keystore.encryptWithKey!(id, message)).rejects.toThrow(
      /neither encryption nor key agreement/,
    );
  });

  it("rehydrates metadata from IndexedDB on reopen and can still sign", async () => {
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

    // Reopen with a fresh store + engine against the same database.
    const store2 = newStore();
    const keystore2 = await makeKeyStore(store2, databaseName);
    expect(store2.state.keys.map((k) => k.id).sort()).toEqual([acctId, rootId, seedId].sort());
    // Signing works after rehydration (root fetched + re-derived just-in-time).
    expect(await keystore2.verify(acctId, message, signature)).toBe(true);
    const signature2 = await keystore2.sign(acctId, message);
    expect(await keystore2.verify(acctId, message, signature2)).toBe(true);
  });

  it("removes a key from both storage and the reactive store", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(store.state.keys.some((k) => k.id === id)).toBe(true);
    await keystore.remove(id);
    expect(store.state.keys.some((k) => k.id === id)).toBe(false);
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    expect(await db.get<MaterialRecord>(MATERIAL_STORE, id)).toBeUndefined();
  });
});

describe("createWebKeyStore (custom shim algorithm)", () => {
  // A toy shim that claims a brand-new algorithm name and backs it with the
  // host's ECDSA P-256, so the key handles it hands out are real CryptoKeys.
  const MY_ALG = "My-Alg";
  const ECDSA_KEYGEN = { name: "ECDSA", namedCurve: "P-256" } as EcKeyGenParams;
  const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as EcdsaParams;
  const isMyAlg = (alg: unknown) =>
    (typeof alg === "string" ? alg : (alg as Algorithm | undefined)?.name) === MY_ALG;
  const withMyAlg: SubtleShim = (target) =>
    new Proxy(target, {
      get(t, prop) {
        if (prop === "generateKey") {
          return (alg: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) =>
            t.generateKey(isMyAlg(alg) ? ECDSA_KEYGEN : alg, extractable, usages);
        }
        if (prop === "importKey") {
          return (
            format: Exclude<KeyFormat, "jwk">,
            data: BufferSource,
            alg: AlgorithmIdentifier,
            extractable: boolean,
            usages: KeyUsage[],
          ) => t.importKey(format, data, isMyAlg(alg) ? ECDSA_KEYGEN : alg, extractable, usages);
        }
        if (prop === "sign") {
          return (alg: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) =>
            t.sign(isMyAlg(alg) ? ECDSA_SIGN : alg, key, data);
        }
        if (prop === "verify") {
          return (
            alg: AlgorithmIdentifier,
            key: CryptoKey,
            signature: BufferSource,
            data: BufferSource,
          ) => t.verify(isMyAlg(alg) ? ECDSA_SIGN : alg, key, signature, data);
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });

  let store: Store<KeyStoreState>;
  let databaseName: string;
  let keystore: WebKeyStore;

  beforeEach(async () => {
    store = newStore();
    databaseName = `keystore-test-${dbCounter++}`;
    keystore = await makeKeyStore(store, databaseName, [withMyAlg]);
  });

  it("persists a non-extractable shim key as a CryptoKey in IndexedDB and signs after reopen", async () => {
    const id = await keystore.generate({
      type: "my-type",
      algorithm: MY_ALG,
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(store.state.keys.find((k) => k.id === id)?.metadata?.storage).toBe("cryptokey");
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
    expect(record?.kind).toBe("cryptokey");
    if (record?.kind === "cryptokey") {
      expect(record.privateKey).toBeInstanceOf(CryptoKey);
      expect(record.privateKey.extractable).toBe(false);
    }
    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    // A fresh engine against the same database reads the structured-cloned key back.
    const store2 = newStore();
    const keystore2 = await makeKeyStore(store2, databaseName, [withMyAlg]);
    expect(store2.state.keys.find((k) => k.id === id)?.algorithm).toBe(MY_ALG);
    expect(await keystore2.verify(id, message, signature)).toBe(true);
    const signature2 = await keystore2.sign(id, message);
    expect(await keystore2.verify(id, message, signature2)).toBe(true);
    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore2.verify(id, tampered, signature2)).toBe(false);
  });

  it("persists an extractable shim key as sealed bytes in IndexedDB and signs after reopen", async () => {
    const id = await keystore.generate({
      type: "my-type",
      algorithm: MY_ALG,
      extractable: true,
      keyUsages: ["sign", "verify"],
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.metadata?.storage).toBe("bytes");
    expect(meta?.format).toBe("pkcs8");
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    expect((await db.get<MaterialRecord>(MATERIAL_STORE, id))?.kind).not.toBe("cryptokey");

    const store2 = newStore();
    const keystore2 = await makeKeyStore(store2, databaseName, [withMyAlg]);
    const signature = await keystore2.sign(id, message);
    expect(await keystore2.verify(id, message, signature)).toBe(true);
    expect(await keystore.verify(id, message, signature)).toBe(true);
  });
});

describe("createWebKeyStore (shim handle algorithm)", () => {
  // A toy shim in the house style: opaque `createKeyHandle` handles carrying
  // birth material under the private symbol, never a real CryptoKey. The
  // "signature" is SHA-256(secret || data) and the public key is the secret
  // itself — insecure, but enough to exercise persistence.
  const HANDLE_ALG = "Handle-Alg";
  let lastSecret: Uint8Array;
  const isHandleAlg = (alg: unknown) =>
    (typeof alg === "string" ? alg : (alg as Algorithm | undefined)?.name) === HANDLE_ALG;
  const u8 = (d: BufferSource) =>
    ArrayBuffer.isView(d)
      ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
      : new Uint8Array(d);
  const mac = async (key: CryptoKey, data: BufferSource) => {
    const secret = consumeKeyMaterial(key, (m) => Uint8Array.from(m));
    const input = new Uint8Array([...secret, ...u8(data)]);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  };
  const withHandleAlg: SubtleShim = (target) =>
    new Proxy(target, {
      get(t, prop) {
        if (prop === "generateKey") {
          return async (alg: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
            if (!isHandleAlg(alg)) return t.generateKey(alg, extractable, usages);
            lastSecret = crypto.getRandomValues(new Uint8Array(32));
            const name = HANDLE_ALG;
            return {
              privateKey: createKeyHandle(
                "private",
                { name },
                extractable,
                ["sign"],
                lastSecret.slice(),
              ),
              publicKey: createKeyHandle("public", { name }, true, ["verify"], lastSecret.slice()),
            };
          };
        }
        if (prop === "exportKey") {
          return async (format: KeyFormat, key: CryptoKey) =>
            isHandleAlg(key.algorithm)
              ? consumeKeyMaterial(key, (m) => Uint8Array.from(m).buffer)
              : t.exportKey(format as Exclude<KeyFormat, "jwk">, key);
        }
        if (prop === "importKey") {
          return async (
            format: Exclude<KeyFormat, "jwk">,
            data: BufferSource,
            alg: AlgorithmIdentifier,
            extractable: boolean,
            usages: KeyUsage[],
          ) => {
            if (!isHandleAlg(alg)) return t.importKey(format, data, alg, extractable, usages);
            const type = format === "spki" ? "public" : "private";
            return createKeyHandle(
              type,
              { name: HANDLE_ALG },
              extractable,
              usages,
              u8(data).slice(),
            );
          };
        }
        if (prop === "sign") {
          return async (alg: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) =>
            isHandleAlg(alg) ? (await mac(key, data)).buffer : t.sign(alg, key, data);
        }
        if (prop === "verify") {
          return async (
            alg: AlgorithmIdentifier,
            key: CryptoKey,
            signature: BufferSource,
            data: BufferSource,
          ) => {
            if (!isHandleAlg(alg)) return t.verify(alg, key, signature, data);
            const expected = await mac(key, data);
            const actual = u8(signature);
            return expected.length === actual.length && expected.every((b, i) => b === actual[i]);
          };
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });

  it("seals a non-extractable shim handle key with the vault instead of cloning the handle", async () => {
    const store = newStore();
    const databaseName = `keystore-test-${dbCounter++}`;
    const keystore = await makeKeyStore(store, databaseName, [withHandleAlg]);
    const id = await keystore.generate({
      type: "handle-type",
      algorithm: HANDLE_ALG,
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.metadata?.storage).toBe("bytes");
    expect(meta?.extractable).toBe(false);

    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const record = await db.get<MaterialRecord>(MATERIAL_STORE, id);
    expect(record?.kind).toBe("bytes");
    if (record?.kind === "bytes") {
      expect(containsSubarray(record.ciphertext, lastSecret)).toBe(false);
    }

    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    // A fresh engine against the same database opens the sealed bytes.
    const keystore2 = await makeKeyStore(newStore(), databaseName, [withHandleAlg]);
    const signature2 = await keystore2.sign(id, message);
    expect(signature2).toEqual(signature);
    expect(await keystore2.verify(id, message, signature2)).toBe(true);
    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore2.verify(id, tampered, signature2)).toBe(false);
  });
});

/** Returns true if `haystack` contains the contiguous byte run `needle`. */
function containsSubarray(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
