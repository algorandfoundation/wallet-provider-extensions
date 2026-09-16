import "fake-indexeddb/auto";

import {
  type KeyStoreState,
  type SubtleShim,
  type XHDBinding,
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
): Promise<WebKeyStore> {
  const shims: SubtleShim[] = [
    (h) => withSubtleXHD(h, xhd),
    (h) => withSubtleFalcon1024(h, falcon),
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
