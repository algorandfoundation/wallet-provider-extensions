/**
 * Exercises the shared {@link createKeyStore} orchestrator against a **byte-only**
 * driver (`nativeCryptoKey: false`) — the tier every non-IndexedDB backend
 * (Keychain/MMKV, filesystem, SQL, …) uses.
 *
 * The IndexedDB engine test already covers the `nativeCryptoKey: true` path
 * where standard keys persist as non-extractable {@link CryptoKey}s. Here every
 * key — including standard host keys — is serialized to sealed bytes, so this
 * proves the orchestrator's byte-only branches: `generateEd25519`/`generateHostKey`
 * byte serialization, just-in-time re-import at `sign`, SPKI-based `verify`, and
 * the HD/Falcon shim paths that are byte-only on every backend.
 */

import { DeterministicP256 } from "@algorandfoundation/dp256";
import { KeyContext, XHDWalletAPI, fromSeed, harden } from "@algorandfoundation/xhd-wallet-api";
import { sha512_256 } from "@noble/hashes/sha2.js";
import * as bip39lib from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import * as falcon from "falcon-1024";
import { beforeEach, describe, expect, it } from "vitest";

import { createKeyStore, type KeyStore } from "./create.ts";
import type { DriverCapabilities, DriverMaterial, KeyStoreDriver } from "./types/driver.ts";
import type { Key, KeyId } from "./types/core.ts";
import type { KeyStoreState } from "./types/extension.ts";
import {
  type Algo25Binding,
  type BIP39Binding,
  type DP256Binding,
  type SubtleShim,
  type XHDBinding,
  withSubtleAlgo25,
  withSubtleBIP39,
  withSubtleDP256,
  withSubtleFalcon1024,
  withSubtleXHD,
} from "./shims/index.ts";

const message = new TextEncoder().encode("the quick brown fox");
const host = globalThis.crypto.subtle;

// Same adapter shape the web engine + shim tests use: exposes the (otherwise
// private) rawSign of XHDWalletAPI so the core shim can drive derivation.
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

// Deterministic-P256 (passkey) binding, mirroring what a platform injects.
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

// BIP39 binding backed by `@scure/bip39`, mirroring what a platform injects.
const bip39: BIP39Binding = {
  generateMnemonic: (strength) => bip39lib.generateMnemonic(englishWordlist, strength),
  entropyToMnemonic: (entropy) => bip39lib.entropyToMnemonic(entropy, englishWordlist),
  mnemonicToEntropy: (mnemonic) => bip39lib.mnemonicToEntropy(mnemonic, englishWordlist),
  mnemonicToSeed: (mnemonic, passphrase) => bip39lib.mnemonicToSeed(mnemonic, passphrase),
};

// Algo25 binding: the 25-word Algorand mnemonic is a reversible encoding of a
// 32-byte seed (24 words of 11 bits + a `sha512_256(seed)[:2]` checksum word),
// mirroring the wallet example's demo helpers.
function bytesTo11Bit(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer |= b << bits;
    bits += 8;
    if (bits >= 11) {
      out.push(buffer & 0x7ff);
      buffer >>>= 11;
      bits -= 11;
    }
  }
  if (bits > 0) out.push(buffer & 0x7ff);
  return out;
}
function elevenBitToBytes(words: number[], byteLen = 32): Uint8Array {
  const out = new Uint8Array(byteLen);
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const w of words) {
    buffer |= (w & 0x7ff) << bits;
    bits += 11;
    while (bits >= 8 && i < byteLen) {
      out[i++] = buffer & 0xff;
      buffer >>>= 8;
      bits -= 8;
    }
  }
  return out;
}
function seedToAlgo25(seed: Uint8Array): string {
  const indices = bytesTo11Bit(seed).slice(0, 24);
  const checksum = bytesTo11Bit(sha512_256(seed))[0]!;
  return [...indices, checksum].map((idx) => englishWordlist[idx]!).join(" ");
}
function algo25ToSeed(mnemonic: string): Uint8Array {
  const words = mnemonic.trim().split(/\s+/);
  const indices = words.map((w) => englishWordlist.indexOf(w));
  return elevenBitToBytes(indices.slice(0, 24), 32);
}
const algo25: Algo25Binding = {
  generateMnemonic: () => seedToAlgo25(globalThis.crypto.getRandomValues(new Uint8Array(32))),
  seedToMnemonic: (seed) => seedToAlgo25(seed),
  mnemonicToSeed: (mnemonic) => algo25ToSeed(mnemonic),
};

// The composable shim stack the keystore is created with, one decorator per
// algorithm with its binding already applied.
const shims: SubtleShim[] = [
  (h) => withSubtleXHD(h, xhd),
  (h) => withSubtleFalcon1024(h, falcon),
  (h) => withSubtleDP256(h, dp256),
  (h) => withSubtleBIP39(h, bip39),
  (h) => withSubtleAlgo25(h, algo25),
];

const CAPABILITIES: DriverCapabilities = {
  nativeCryptoKey: false,
  interactiveUnlock: false,
  authFactors: [],
};

interface SealedRecord {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * An in-memory, byte-only {@link KeyStoreDriver} that seals material at rest
 * with a real AES-GCM master key (so "encrypted at rest" is genuinely testable)
 * and keeps metadata in a plain map. It refuses `cryptokey` material, matching a
 * real byte-only backend.
 */
async function createMemoryByteDriver(): Promise<{
  driver: KeyStoreDriver<void>;
  materials: Map<KeyId, SealedRecord>;
}> {
  const master = await host.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const materials = new Map<KeyId, SealedRecord>();
  const metadata = new Map<KeyId, Key>();

  const driver: KeyStoreDriver<void> = {
    capabilities: CAPABILITIES,

    async put(id: KeyId, material: DriverMaterial): Promise<void> {
      if (material.kind !== "bytes") {
        throw new Error("byte-only driver cannot persist a CryptoKey");
      }
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = new Uint8Array(
        await host.encrypt(
          { name: "AES-GCM", iv } as AesGcmParams,
          master,
          material.bytes as unknown as BufferSource,
        ),
      );
      materials.set(id, { iv, ciphertext });
      material.bytes.fill(0);
    },

    async use<T>(
      id: KeyId,
      _ctx: void,
      fn: (material: DriverMaterial) => T | Promise<T>,
    ): Promise<T> {
      const record = materials.get(id);
      if (!record) throw new Error(`no material for ${id}`);
      const bytes = new Uint8Array(
        await host.decrypt(
          { name: "AES-GCM", iv: record.iv } as AesGcmParams,
          master,
          record.ciphertext as unknown as BufferSource,
        ),
      );
      try {
        return await fn({ kind: "bytes", bytes });
      } finally {
        bytes.fill(0);
      }
    },

    async remove(id: KeyId): Promise<void> {
      materials.delete(id);
      metadata.delete(id);
    },

    async clear(): Promise<void> {
      materials.clear();
      metadata.clear();
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

  return { driver, materials };
}

/** Decodes a hex string into bytes. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// A fixed Ed25519 test vector, independently derived via Node's native
// `crypto.subtle` (PKCS#8-wrap the seed, import, export the JWK `x`, sign),
// so the import tests below can cross-check the orchestrator's output against
// a value that was not produced by the code under test.
const KNOWN_ED25519_SEED = hexToBytes(
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
);
const KNOWN_ED25519_PUBLIC_KEY = hexToBytes(
  "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664",
);
const KNOWN_ED25519_SIGNATURE = hexToBytes(
  "e25dccfb50f0791f8583eecfe170ba84efceb7b2349f969886ac3df5c8ab55b07f6fb2fa5a08774f518665103f2ab5d5911b0f91178dce42da72501679074e06",
);

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

describe("createKeyStore (byte-only driver)", () => {
  let store: Store<KeyStoreState>;
  let keystore: KeyStore<void>;
  let materials: Map<KeyId, SealedRecord>;

  beforeEach(async () => {
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const built = await createMemoryByteDriver();
    materials = built.materials;
    keystore = createKeyStore<void>({
      driver: built.driver,
      store,
      subtle: host,
      shims,
    });
    await keystore.ready;
  });

  it("stores a standard Ed25519 key as sealed bytes and signs/verifies", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const meta = store.state.keys.find((k) => k.id === id);
    // On a byte-only backend the private key is serialized (pkcs8), never a CryptoKey.
    expect(meta?.metadata?.storage).toBe("bytes");
    expect(materials.has(id)).toBe(true);

    const signature = await keystore.sign(id, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("stores a generic host ECDSA P-256 key as sealed bytes and signs/verifies", async () => {
    const id = await keystore.generate({
      type: "ecc",
      algorithm: "ECDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { namedCurve: "P-256", hash: "SHA-256" },
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.metadata?.storage).toBe("bytes");
    // The public key is recorded as SPKI so verify never needs to unlock material.
    expect(meta?.metadata?.spki).toBe(true);
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);

    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("runs the passkey flow: entropy → dp256 main → domain key → sign/verify", async () => {
    const entropy = new Uint8Array(16).fill(9);
    const mainId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "P256",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      // `seed` is consumed as PBKDF2 entropy; a low iteration count keeps the test fast.
      params: { seed: entropy, iterationCount: 32 },
    });
    const mainMeta = store.state.keys.find((k) => k.id === mainId);
    expect(mainMeta?.type).toBe("hd-root-key");
    expect(mainMeta?.algorithm).toBe("P256");
    expect(mainMeta?.metadata?.scheme).toBe("pbkdf2-p256");
    // The generation entropy must never leak into (plaintext) metadata.
    expect(mainMeta?.metadata?.seed).toBeUndefined();
    expect(materials.has(mainId)).toBe(true);

    const passkeyId = await keystore.deriveDomainKey!(mainId, {
      algorithm: "P256",
      origin: "https://example.com",
      userHandle: "user-123",
    });
    const passkeyMeta = store.state.keys.find((k) => k.id === passkeyId);
    expect(passkeyMeta?.type).toBe("hd-derived-p256");
    expect(passkeyMeta?.metadata?.storage).toBe("none");
    expect(passkeyMeta?.metadata?.origin).toBe("https://example.com");
    expect(passkeyMeta?.metadata?.userHandle).toBe("user-123");
    expect(passkeyMeta?.publicKey).toBeInstanceOf(Uint8Array);
    // The domain key is metadata-only; no secret is persisted for it.
    expect(materials.has(passkeyId)).toBe(false);

    const signature = await keystore.sign(passkeyId, message);
    expect(signature.byteLength).toBe(64);
    expect(await keystore.verify(passkeyId, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(passkeyId, tampered, signature)).toBe(false);
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

    const record = materials.get(rootId);
    expect(record).toBeDefined();
    const plaintextRoot = fromSeed(Buffer.from(seed));
    expect(containsSubarray(record!.ciphertext, plaintextRoot)).toBe(false);

    const meta = store.state.keys.find((k) => k.id === rootId);
    expect((meta as unknown as Record<string, unknown>).privateKey).toBeUndefined();
  });

  it("removes a key from both storage and the reactive store", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(store.state.keys.some((k) => k.id === id)).toBe(true);
    expect(materials.has(id)).toBe(true);

    await keystore.remove(id);
    expect(store.state.keys.some((k) => k.id === id)).toBe(false);
    expect(materials.has(id)).toBe(false);
  });

  it("clears every key from both storage and the reactive store", async () => {
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
    expect(materials.size).toBe(2);

    // clear is exposed because the byte driver implements it.
    await keystore.clear!();
    expect(store.state.keys.length).toBe(0);
    expect(materials.size).toBe(0);
  });

  it("encrypts and decrypts round-trip with a key's public key", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const plaintext = new TextEncoder().encode("negotiation payload");
    const ciphertext = await keystore.encryptWithKey!(id, plaintext);
    // Version byte + 12-byte IV + AES-GCM output (>= plaintext + 16-byte tag).
    expect(ciphertext[0]).toBe(1);
    expect(ciphertext.byteLength).toBeGreaterThan(plaintext.byteLength + 12);
    const decrypted = await keystore.decryptWithKey!(id, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("negotiation payload");
  });

  it("rejects a ciphertext with an unsupported version", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const garbage = crypto.getRandomValues(new Uint8Array(64));
    garbage[0] = 2; // version 2 is unsupported
    await expect(keystore.decryptWithKey!(id, garbage)).rejects.toThrow(
      /unsupported ciphertext version/,
    );
  });

  it("never records generation secrets in (plaintext) metadata", async () => {
    const passphrase = "the 25th word";
    const inlineSeed = new Uint8Array(32).fill(3);
    const secretOf = (id: KeyId): Record<string, unknown> =>
      (store.state.keys.find((k) => k.id === id)?.metadata ?? {}) as Record<string, unknown>;

    const seedId = await keystore.generate({
      type: "seed",
      algorithm: "BIP39",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { strength: 128, passphrase },
    });
    // `protected` records that a passphrase is required — the passphrase itself
    // is never persisted.
    expect(secretOf(seedId).protected).toBe(true);
    expect(secretOf(seedId).passphrase).toBeUndefined();

    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { seed: inlineSeed, label: "root" },
    });
    expect(secretOf(rootId).seed).toBeUndefined();
    // Non-secret params still ride along.
    expect(secretOf(rootId).label).toBe("root");

    const mainId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "P256",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      // `seed` is consumed as PBKDF2 entropy; a low iteration count keeps it fast.
      params: {
        seed: new Uint8Array(16).fill(9),
        iterationCount: 32,
        salt: new Uint8Array(16).fill(2),
        passphrase,
      },
    });
    expect(secretOf(mainId).seed).toBeUndefined();
    expect(secretOf(mainId).salt).toBeUndefined();
    expect(secretOf(mainId).passphrase).toBeUndefined();

    const falconId = await keystore.generate({
      type: "falcon-1024",
      algorithm: "Falcon-1024",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { seed: new Uint8Array(48).fill(5) },
    });
    expect(secretOf(falconId).seed).toBeUndefined();

    const ed25519Id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { passphrase },
    });
    expect(secretOf(ed25519Id).passphrase).toBeUndefined();

    // A host key records `signAlgorithm` for later verification — that copy of
    // the params is sanitized the same way, and verification must still work.
    const hostId = await keystore.generate({
      type: "ecc",
      algorithm: "ECDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { namedCurve: "P-256", hash: "SHA-256", salt: new Uint8Array(8), label: "host" },
    });
    expect(secretOf(hostId).salt).toBeUndefined();
    expect((secretOf(hostId).signAlgorithm as Record<string, unknown>).salt).toBeUndefined();
    // Params the engine does not treat as secrets are the caller's own metadata
    // and are recorded verbatim.
    expect(secretOf(hostId).label).toBe("host");
    const hostSignature = await keystore.sign(hostId, message);
    expect(await keystore.verify(hostId, message, hostSignature)).toBe(true);

    // The passphrase is nowhere in the reactive/RPC/persisted metadata mirror.
    expect(JSON.stringify(store.state.keys)).not.toContain(passphrase);
  });

  it("seals the seed passphrase only when the caller opts in", async () => {
    const passphrase = "the 25th word";
    const seedOptions = {
      type: "seed",
      algorithm: "BIP39",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
    } as const;

    const plainId = await keystore.generate({
      ...seedOptions,
      params: { strength: 128, passphrase },
    });
    expect(store.state.keys.find((k) => k.id === plainId)?.metadata?.passphraseSecretId).toBe(
      undefined,
    );

    const sealedId = await keystore.generate({
      ...seedOptions,
      params: { strength: 128, passphrase, storePassphrase: true },
    });
    const secretId = store.state.keys.find((k) => k.id === sealedId)?.metadata
      ?.passphraseSecretId as string;
    expect(secretId).toBe(`${sealedId}.passphrase`);

    // An ordinary secret-store entry: readable, listed, never in metadata.
    const stored = await keystore.secrets!.get(secretId);
    expect(new TextDecoder().decode(stored)).toBe(passphrase);
    expect((await keystore.secrets!.list()).some((k) => k.id === secretId)).toBe(true);
    expect(JSON.stringify(store.state.keys)).not.toContain(passphrase);
  });

  it("derives with the sealed passphrase without being handed it again", async () => {
    const passphrase = "the 25th word";
    const seedId = await keystore.generate({
      type: "seed",
      algorithm: "BIP39",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { strength: 128, passphrase, storePassphrase: true },
    });

    const accountKeyFor = async (params: Record<string, unknown>): Promise<number[]> => {
      const rootId = await keystore.generate({
        type: "hd-root-key",
        algorithm: "raw",
        extractable: false,
        keyUsages: ["sign"],
        params,
      });
      const acctId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
      const publicKey = store.state.keys.find((k) => k.id === acctId)?.publicKey;
      return Array.from(publicKey as Uint8Array);
    };

    const implicit = await accountKeyFor({ parentKeyId: seedId });
    const explicit = await accountKeyFor({ parentKeyId: seedId, passphrase });
    const wrong = await accountKeyFor({ parentKeyId: seedId, passphrase: "another word" });

    expect(implicit).toEqual(explicit);
    expect(implicit).not.toEqual(wrong);
  });

  it("drops the sealed passphrase when its seed is removed", async () => {
    const seedId = await keystore.generate({
      type: "seed",
      algorithm: "BIP39",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { strength: 128, passphrase: "the 25th word", storePassphrase: true },
    });
    const secretId = `${seedId}.passphrase`;
    expect(materials.has(secretId)).toBe(true);

    await keystore.remove(seedId);

    expect(materials.has(secretId)).toBe(false);
    expect(store.state.keys.some((k) => k.id === secretId)).toBe(false);
  });

  it("derives a matching XHD shared secret between two derived accounts (ECDH)", async () => {
    const seed = new Uint8Array(32).fill(5);
    const seedId = await keystore.importSeed!(seed);
    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const aliceId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const bobId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/1'/0/0");
    const alice = store.state.keys.find((k) => k.id === aliceId);
    const bob = store.state.keys.find((k) => k.id === bobId);

    // Alice derives against Bob's public key (me first); Bob derives against
    // Alice's public key (not me first). ECDH is symmetric, so they agree.
    const aliceSecret = await keystore.deriveSharedSecret!(aliceId, bob!.publicKey!, true);
    const bobSecret = await keystore.deriveSharedSecret!(bobId, alice!.publicKey!, false);
    expect(aliceSecret.byteLength).toBe(32);
    expect(Array.from(aliceSecret)).toEqual(Array.from(bobSecret));
  });

  it("generates a BIP39 seed as recoverable entropy and derives an HD account from it", async () => {
    const seedId = await keystore.generate({
      type: "seed",
      algorithm: "BIP39",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { strength: 128 },
    });
    const seedMeta = store.state.keys.find((k) => k.id === seedId);
    expect(seedMeta?.type).toBe("seed");
    expect(seedMeta?.metadata?.scheme).toBe("bip39");
    // Only the recoverable 16-byte entropy is persisted, never the 64-byte seed
    // and never the mnemonic itself.
    const sealed = materials.get(seedId);
    expect(sealed).toBeDefined();
    expect(seedMeta?.metadata?.protected).toBeUndefined();

    // The stored entropy converts to the 96-byte XHD root just-in-time, so an
    // account can be derived, signed with and verified — proving the
    // entropy → seed → root pipeline end-to-end.
    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { parentKeyId: seedId },
    });
    const accountId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const signature = await keystore.sign(accountId, message);
    expect(await keystore.verify(accountId, message, signature)).toBe(true);
  });

  it("generates an Algo25 seed (entropy == seed) and derives an HD account from it", async () => {
    const seedId = await keystore.generate({
      type: "seed",
      algorithm: "Algo25",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
    });
    const seedMeta = store.state.keys.find((k) => k.id === seedId);
    expect(seedMeta?.metadata?.scheme).toBe("algo25");

    const rootId = await keystore.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { parentKeyId: seedId },
    });
    const accountId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
    const signature = await keystore.sign(accountId, message);
    expect(await keystore.verify(accountId, message, signature)).toBe(true);
  });

  it("stores, reads back, lists and removes arbitrary secrets (sealed at rest)", async () => {
    const token = "super-secret-api-token";
    const id = await keystore.secrets!.put(token, { name: "API Token" });

    // Metadata is mirrored (never the value) and the value is sealed at rest.
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.type).toBe("secret-key");
    expect(meta?.keyUsages).toEqual([]);
    expect((meta as { privateKey?: unknown })?.privateKey).toBeUndefined();
    const sealed = materials.get(id);
    expect(sealed).toBeDefined();
    expect(containsSubarray(sealed!.ciphertext, new TextEncoder().encode(token))).toBe(false);

    // Unlike key material, a secret reads back in plaintext.
    const value = await keystore.secrets!.get(id);
    expect(new TextDecoder().decode(value)).toBe(token);

    // Bytes round-trip too.
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const rawId = await keystore.secrets!.put(raw);
    expect(Array.from(await keystore.secrets!.get(rawId))).toEqual([1, 2, 3, 4, 5]);

    const secrets = await keystore.secrets!.list();
    expect(secrets.map((s) => s.id).sort()).toEqual([id, rawId].sort());

    await keystore.secrets!.remove(id);
    expect(store.state.keys.find((k) => k.id === id)).toBeUndefined();
    expect(materials.has(id)).toBe(false);
  });

  it("rejects reading a non-secret key through the secret store", async () => {
    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    await expect(keystore.secrets!.get(id)).rejects.toThrow(/not a secret/);
  });

  it("imports a known Ed25519 private key under an explicit id and signs/verifies", async () => {
    const id = await keystore.import({
      id: "imported-ed25519",
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      privateKey: KNOWN_ED25519_SEED,
    });
    expect(id).toBe("imported-ed25519");

    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.type).toBe("ed25519");
    expect(meta?.metadata?.storage).toBe("bytes");
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(meta!.publicKey!)).toEqual(Array.from(KNOWN_ED25519_PUBLIC_KEY));
    expect(materials.has(id)).toBe(true);

    // A freshly produced signature verifies through the keystore itself...
    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    // ...and a signature produced independently (via Node's native
    // `crypto.subtle`, hardcoded as `KNOWN_ED25519_SIGNATURE`) verifies too,
    // proving the imported key is byte-for-byte the same private key.
    expect(await keystore.verify(id, message, KNOWN_ED25519_SIGNATURE)).toBe(true);

    // Cross-check directly against the host Subtle with the known public key.
    const publicKey = await host.importKey(
      "raw",
      KNOWN_ED25519_PUBLIC_KEY as unknown as BufferSource,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    expect(
      await host.verify(
        { name: "Ed25519" },
        publicKey,
        signature as unknown as BufferSource,
        message as unknown as BufferSource,
      ),
    ).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });

  it("rejects an ed25519 import whose publicKey contradicts the privateKey", async () => {
    const wrongPublicKey = new Uint8Array(KNOWN_ED25519_PUBLIC_KEY);
    wrongPublicKey[0] ^= 0xff;
    await expect(
      keystore.import({
        type: "ed25519",
        algorithm: "EdDSA",
        extractable: false,
        keyUsages: ["sign", "verify"],
        privateKey: KNOWN_ED25519_SEED,
        publicKey: wrongPublicKey,
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("rejects an ed25519 import with a wrong-length privateKey", async () => {
    await expect(
      keystore.import({
        type: "ed25519",
        algorithm: "EdDSA",
        extractable: false,
        keyUsages: ["sign", "verify"],
        privateKey: new Uint8Array(16),
      }),
    ).rejects.toThrow(/32-byte/);
  });

  it("imports a seed under a caller-supplied id", async () => {
    const seed = new Uint8Array(32).fill(4);
    const id = await keystore.import({
      id: "imported-seed",
      type: "seed",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      privateKey: seed,
    });
    expect(id).toBe("imported-seed");
    expect(store.state.keys.find((k) => k.id === id)?.type).toBe("seed");
    expect(materials.has(id)).toBe(true);
  });
});

describe("createKeyStore (hooks)", () => {
  it("applies creation-time hooks around operations and exposes them", async () => {
    const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const built = await createMemoryByteDriver();
    const hooks = new Hook.Collection<any>();
    const keystore = createKeyStore<void>({
      driver: built.driver,
      store,
      subtle: host,
      shims,
      hooks,
    });
    await keystore.ready;

    // The bound collection is exposed for consumers to register interceptors.
    expect(keystore.hooks).toBe(hooks);

    const events: string[] = [];
    keystore.hooks!.before("generate", () => {
      events.push("before:generate");
    });
    keystore.hooks!.after("generate", () => {
      events.push("after:generate");
    });
    keystore.hooks!.before("sign", () => {
      events.push("before:sign");
    });

    const id = await keystore.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    await keystore.sign(id, message);

    expect(events).toEqual(["before:generate", "after:generate", "before:sign"]);
  });

  it("lets a before hook cancel an operation by throwing", async () => {
    const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const built = await createMemoryByteDriver();
    const hooks = new Hook.Collection<any>();
    const keystore = createKeyStore<void>({
      driver: built.driver,
      store,
      subtle: host,
      shims,
      hooks,
    });
    await keystore.ready;

    keystore.hooks!.before("generate", () => {
      throw new Error("blocked by hook");
    });
    await expect(
      keystore.generate({
        type: "ed25519",
        algorithm: "EdDSA",
        extractable: false,
        keyUsages: ["sign", "verify"],
      }),
    ).rejects.toThrow("blocked by hook");
    expect(store.state.keys.length).toBe(0);
  });
});

describe("createKeyStore (default shims)", () => {
  // No `shims` supplied — the orchestrator falls back to `createDefaultShims()`,
  // so every supported algorithm is understood with zero wiring.
  let store: Store<KeyStoreState>;
  let keystore: KeyStore<void>;

  beforeEach(async () => {
    store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const built = await createMemoryByteDriver();
    keystore = createKeyStore<void>({ driver: built.driver, store, subtle: host });
    await keystore.ready;
  });

  it("understands BIP32-Ed25519 out of the box (seed → root → derived → sign/verify)", async () => {
    const seed = new Uint8Array(32).fill(7);
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
    expect(await keystore.verify(acctId, message, signature)).toBe(true);
  });

  it("understands Falcon-1024 out of the box (generate → sign/verify)", async () => {
    const seed = new Uint8Array(48).fill(9);
    const id = await keystore.generate({
      type: "falcon-1024",
      algorithm: "Falcon-1024",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { seed },
    });
    const signature = await keystore.sign(id, message);
    expect(await keystore.verify(id, message, signature)).toBe(true);
  });

  it("reports its capabilities (host + shim) via state.algorithms once ready", () => {
    // The default (tagged) shim stack is fully available in this test env, so
    // every add-on surfaces its algorithm identifier, tagged `source: "shim"`.
    expect(store.state.algorithms).toEqual(
      expect.arrayContaining([
        { algorithm: "BIP32-Ed25519", source: "shim" },
        { algorithm: "Falcon-1024", source: "shim" },
        { algorithm: "Deterministic-P256", source: "shim" },
        { algorithm: "BIP39", source: "shim" },
        { algorithm: "Algo25", source: "shim" },
      ]),
    );
    // The baseline host algorithms are reported too, tagged `source: "host"`.
    expect(store.state.algorithms).toEqual(
      expect.arrayContaining([
        { algorithm: "Ed25519", source: "host" },
        { algorithm: "AES-GCM", source: "host" },
      ]),
    );
  });
});
