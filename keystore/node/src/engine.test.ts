import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import { Store } from "@tanstack/store";
import { beforeEach, describe, expect, it } from "vitest";

import { createNodeKeyStore, type NodeKeyStore } from "./engine.ts";
import type { KeyringBinding } from "./storage/keyring.ts";
import type { MetadataFile } from "./storage/metadata.ts";

const message = new TextEncoder().encode("the quick brown fox");
// A fixed Ed25519 seed used to exercise `import`; the resulting public key is
// asserted against, so any regression in the PKCS#8 wrapping / derivation
// would be caught rather than silently accepted.
const KNOWN_ED25519_SEED = new Uint8Array(32).map((_, i) => i + 1);
// Node's global webcrypto stands in for the host Subtle (Ed25519 / ECDSA /
// AES-GCM); the core default shims add BIP32-Ed25519 / Falcon-1024 / dp256 /
// BIP39 / Algo25, so no explicit `shims` are needed.
const subtle = globalThis.crypto.subtle;

/** A fresh in-memory OS-keychain fake per test. */
function memoryKeyring(): KeyringBinding & { accounts(): string[] } {
  const map = new Map<string, string>();
  return {
    get: (account) => (map.has(account) ? (map.get(account) as string) : null),
    set: (account, secret) => {
      map.set(account, secret);
    },
    delete: (account) => map.delete(account),
    accounts: () => [...map.keys()],
  };
}

/** A fresh in-memory sealed-metadata file fake per test. */
function memoryMetadata(): MetadataFile & { bytes(): Uint8Array | null } {
  let blob: Uint8Array | null = null;
  return {
    read: () => blob,
    write: (b) => {
      blob = b;
    },
    remove: () => {
      blob = null;
    },
    bytes: () => blob,
  };
}

describe("createNodeKeyStore", () => {
  let store: Store<KeyStoreState>;
  let keyring: ReturnType<typeof memoryKeyring>;
  let metadata: ReturnType<typeof memoryMetadata>;
  let keystore: NodeKeyStore;

  beforeEach(async () => {
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    keyring = memoryKeyring();
    metadata = memoryMetadata();
    keystore = createNodeKeyStore({ store, subtle, keyring, metadata });
    await keystore.ready;
  });

  it("stores an Ed25519 key in the keychain and signs/verifies", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    // Material lives in the keychain; a master key was minted to seal metadata.
    expect(keyring.get(`m/${id}`)).not.toBeNull();
    expect(keyring.get("__keystore.master__")).not.toBeNull();
    // Metadata is sealed to the file, not stored per-key in the keychain.
    expect(metadata.bytes()).not.toBeNull();

    const signature = await keystore.sign(id, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("imports an existing Ed25519 private key under a caller id and signs/verifies", async () => {
    const id = await keystore.import({
      id: "ac2-service",
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      privateKey: KNOWN_ED25519_SEED,
    });
    expect(id).toBe("ac2-service");
    // The keychain byte-only driver persists the imported key just like a
    // freshly generated one.
    expect(keyring.get(`m/${id}`)).not.toBeNull();

    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.type).toBe("ed25519");
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(meta!.publicKey!).toString("hex")).toBe(
      "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664",
    );

    const signature = await keystore.sign(id, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("stores a standard ECDSA P-256 key and signs/verifies", async () => {
    const id = await keystore.generate({
      type: "p256",
      algorithm: "ECDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { namedCurve: "P-256", hash: "SHA-256" },
    });
    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);
  });

  it("runs the HD Algorand flow: seed → root → derived account → sign/verify", async () => {
    const seed = new Uint8Array(32).fill(7);
    const seedId = await keystore.importSeed!(seed);
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
  });

  it("chunks oversized Falcon-1024 material across numbered keychain entries", async () => {
    const id = await keystore.generate({
      type: "falcon-1024",
      algorithm: "Falcon-1024",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { seed: new Uint8Array(48).fill(2) },
    });
    // A Falcon-1024 private key is far larger than the per-entry chunk cap, so
    // it must be split across `m/<id>`, `m/<id>/1`, … numbered entries.
    const chunks = keyring.accounts().filter((a) => a === `m/${id}` || a.startsWith(`m/${id}/`));
    expect(chunks.length).toBeGreaterThan(1);

    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("seals metadata at rest (no plaintext key id in the file)", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const blob = metadata.bytes();
    expect(blob).not.toBeNull();
    // The sealed blob must not expose the plaintext record (the key id).
    const asText = new TextDecoder().decode(blob as Uint8Array);
    expect(asText.includes(id)).toBe(false);
  });

  it("rehydrates metadata on reopen against the same keychain + file", async () => {
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

    // Reopen with a fresh store + engine over the same keychain + sealed file.
    const store2 = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const keystore2 = createNodeKeyStore({ store: store2, subtle, keyring, metadata });
    await keystore2.ready;
    expect(store2.state.keys.map((k) => k.id).sort()).toEqual([acctId, rootId, seedId].sort());
    expect(await keystore2.verify(acctId, message, signature)).toBe(true);
    const signature2 = await keystore2.sign(acctId, message);
    expect(await keystore2.verify(acctId, message, signature2)).toBe(true);
  });

  it("removes a key from both the keychain and the reactive store", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(keyring.get(`m/${id}`)).not.toBeNull();

    await keystore.remove(id);
    expect(store.state.keys.some((k) => k.id === id)).toBe(false);
    expect(keyring.get(`m/${id}`)).toBeNull();
  });

  it("clears every key while leaving the keychain master key intact", async () => {
    await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(store.state.keys.length).toBe(2);

    await keystore.clear!();
    expect(store.state.keys.length).toBe(0);
    expect(keyring.accounts().some((a) => a.startsWith("m/"))).toBe(false);
    // The master key is retained so future writes reuse it.
    expect(keyring.get("__keystore.master__")).not.toBeNull();
  });
});
