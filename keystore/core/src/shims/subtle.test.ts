import { DeterministicP256 } from "@algorandfoundation/dp256";
import { fromSeed, harden, KeyContext, XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
import { sha512_256 } from "@noble/hashes/sha2.js";
import * as bip39lib from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import * as falcon from "falcon-1024";
import { beforeAll, describe, expect, it } from "vitest";
import { MaterialAccessError } from "../errors.ts";
import { ALGO25_SEED_LENGTH, type Algo25Binding, withSubtleAlgo25 } from "./algo25.ts";
import { type BIP39Binding, withSubtleBIP39 } from "./bip39.ts";
import {
  type DP256Params,
  withSubtleDP256,
  type DP256Binding,
  genDerivedMainKeyWithSubtle,
  withSubtleDerivedMainKey,
} from "./dp256.ts";
import { type FalconParams, withSubtleFalcon1024 } from "./falcon.ts";
import { consumeKeyMaterial, createKeyHandle } from "./shim.ts";
import { BIP32DerivationType, type XHDBinding, type XHDParams, withSubtleXHD } from "./xhd.ts";

const host: SubtleCrypto = crypto.subtle;
const message = new TextEncoder().encode("the quick brown fox");

// WebCrypto's `importKey` keyData is typed as an ArrayBuffer-backed view; the
// primitive libraries hand back `Uint8Array<ArrayBufferLike>`, so normalise for
// the strict overload just like a real consumer would.
const buf = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

// Adapter that exposes the (otherwise private) rawSign of XHDWalletAPI as an
// injected binding, mirroring what the Node platform package provides.
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

// Adapter over the `@algorandfoundation/dp256` class, mirroring what a platform
// package injects. The methods map one-to-one onto the class surface.
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

// BIP39 binding backed by `@scure/bip39`.
const bip39: BIP39Binding = {
  generateMnemonic: (strength) => bip39lib.generateMnemonic(englishWordlist, strength),
  entropyToMnemonic: (entropy) => bip39lib.entropyToMnemonic(entropy, englishWordlist),
  mnemonicToEntropy: (mnemonic) => bip39lib.mnemonicToEntropy(mnemonic, englishWordlist),
  mnemonicToSeed: (mnemonic, passphrase) => bip39lib.mnemonicToSeed(mnemonic, passphrase),
};

// Algo25 binding: a reversible 11-bit-per-word encoding of a 32-byte seed with a
// `sha512_256(seed)[:2]` checksum word (the wallet example's demo scheme).
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
function elevenBitToBytes(words: number[]): Uint8Array {
  const out = new Uint8Array(ALGO25_SEED_LENGTH);
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const w of words) {
    buffer |= (w & 0x7ff) << bits;
    bits += 11;
    while (bits >= 8 && i < ALGO25_SEED_LENGTH) {
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
const algo25: Algo25Binding = {
  generateMnemonic: () => seedToAlgo25(crypto.getRandomValues(new Uint8Array(ALGO25_SEED_LENGTH))),
  seedToMnemonic: (seed) => seedToAlgo25(seed),
  mnemonicToSeed: (mnemonic) =>
    elevenBitToBytes(
      mnemonic
        .trim()
        .split(/\s+/)
        .map((w) => englishWordlist.indexOf(w))
        .slice(0, 24),
    ),
};

describe("withSubtleBIP39", () => {
  const subtle = withSubtleBIP39(host, bip39);

  it("mints entropy at birth and derives the 64-byte seed from it", async () => {
    const key = (await subtle.generateKey(
      { name: "BIP39", strength: 128 } as unknown as AlgorithmIdentifier,
      false,
      ["deriveBits"],
    )) as CryptoKey;
    expect(key.algorithm.name).toBe("BIP39");

    // The just-born entropy is captured once via the privileged channel and
    // wiped after use; persisting entropy keeps the mnemonic recoverable.
    let ref: Uint8Array | undefined;
    const entropy = consumeKeyMaterial(key, (m) => {
      ref = m;
      return Uint8Array.from(m);
    });
    expect(entropy.length).toBe(16); // 128-bit strength
    expect(ref?.every((b) => b === 0)).toBe(true);

    // deriveBits converts a freshly-injected entropy copy into the 64-byte seed
    // and wipes the injected buffer.
    const injected = entropy as unknown as BufferSource;
    const seed = new Uint8Array(
      (await subtle.deriveBits(
        { name: "BIP39", entropy: injected } as unknown as AlgorithmIdentifier,
        key,
      )) as ArrayBuffer,
    );
    expect(seed.length).toBe(64);
    expect((injected as Uint8Array).every((b) => b === 0)).toBe(true);
  });

  it("refuses to move raw material across the public surface", async () => {
    await expect(
      subtle.importKey("raw", buf(new Uint8Array(16)), { name: "BIP39" }, false, ["deriveBits"]),
    ).rejects.toBeInstanceOf(MaterialAccessError);
    const handle = createKeyHandle("private", { name: "BIP39" }, true, ["deriveBits"]);
    await expect(subtle.exportKey("raw", handle)).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("delegates unknown algorithms to the host", async () => {
    expect((await subtle.digest("SHA-256", message)).byteLength).toBe(32);
  });
});

describe("withSubtleAlgo25", () => {
  const subtle = withSubtleAlgo25(host, algo25);

  it("mints a 32-byte seed at birth and returns it from deriveBits", async () => {
    const key = (await subtle.generateKey(
      { name: "Algo25" } as unknown as AlgorithmIdentifier,
      false,
      ["deriveBits"],
    )) as CryptoKey;
    const seed = consumeKeyMaterial(key, (m) => Uint8Array.from(m));
    expect(seed.length).toBe(32);

    const injected = Uint8Array.from(seed) as unknown as BufferSource;
    const derived = new Uint8Array(
      (await subtle.deriveBits(
        { name: "Algo25", entropy: injected } as unknown as AlgorithmIdentifier,
        key,
      )) as ArrayBuffer,
    );
    // For Algo25 the mnemonic *is* the seed, so the derived seed equals the
    // persisted entropy; the injected buffer is wiped.
    expect(Array.from(derived)).toEqual(Array.from(seed));
    expect((injected as Uint8Array).every((b) => b === 0)).toBe(true);
  });

  it("rejects an entropy of the wrong length", async () => {
    const key = createKeyHandle("private", { name: "Algo25" }, false, ["deriveBits"]);
    await expect(
      subtle.deriveBits(
        { name: "Algo25", entropy: buf(new Uint8Array(16)) } as unknown as AlgorithmIdentifier,
        key,
      ),
    ).rejects.toThrow();
  });

  it("refuses to move raw material across the public surface", async () => {
    const handle = createKeyHandle("private", { name: "Algo25" }, true, ["deriveBits"]);
    await expect(subtle.exportKey("raw", handle)).rejects.toBeInstanceOf(MaterialAccessError);
  });
});

describe("withSubtleFalcon1024", () => {
  const subtle = withSubtleFalcon1024(host, falcon);

  const seed = new Uint8Array(48).fill(9);

  // Each generation gets a fresh seed copy because `generateKey` wipes the seed
  // it consumes (injected private material must not linger in memory).
  const genParams = (): FalconParams => ({ name: "Falcon-1024", seed: buf(Uint8Array.from(seed)) });

  it("mints a seed-derived keypair carrying material for the storage engine", async () => {
    // The seed is wiped once it has been consumed by generation.
    const seedCopy = Uint8Array.from(seed);
    const genSeed: FalconParams = { name: "Falcon-1024", seed: buf(seedCopy) };
    const { privateKey, publicKey } = (await subtle.generateKey(genSeed, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    expect(seedCopy.every((b) => b === 0)).toBe(true);

    expect(privateKey.type).toBe("private");
    expect(publicKey.type).toBe("public");
    expect(privateKey.algorithm.name).toBe("Falcon-1024");
    expect(privateKey.usages).toEqual(["sign"]);
    expect(publicKey.usages).toEqual(["verify"]);

    // The fresh material is reachable only through the privileged channel a
    // storage engine uses, not the public CryptoKey shape — and only once. The
    // buffer handed to `use` is wiped and its reference dropped the instant the
    // consumer returns, so the plaintext does not linger in memory.
    let privRef: Uint8Array | undefined;
    let pubRef: Uint8Array | undefined;
    const priv = consumeKeyMaterial(privateKey, (m) => {
      privRef = m;
      return Uint8Array.from(m);
    });
    const pub = consumeKeyMaterial(publicKey, (m) => {
      pubRef = m;
      return Uint8Array.from(m);
    });
    expect(priv).toBeInstanceOf(Uint8Array);
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(Object.keys(privateKey)).not.toContain("material");

    // After consumption the plaintext is zeroed and cannot be read a second time.
    expect(privRef?.every((b) => b === 0)).toBe(true);
    expect(pubRef?.every((b) => b === 0)).toBe(true);
    expect(() => consumeKeyMaterial(privateKey, (m) => m)).toThrow(MaterialAccessError);

    // Generation is deterministic from the seed (recoverable from a mnemonic).
    const again = (await subtle.generateKey(genParams(), false, ["sign"])) as CryptoKeyPair;
    expect(consumeKeyMaterial(again.privateKey, (m) => Uint8Array.from(m))).toEqual(priv);

    // The material the engine persisted round-trips through sign/verify; signing
    // wipes the injected private key so it does not survive the call.
    const signMaterial = buf(priv);
    const signParams: FalconParams = { name: "Falcon-1024", privateKey: signMaterial };
    const signature = await subtle.sign(signParams, privateKey, message);
    expect((signMaterial as Uint8Array).every((b) => b === 0)).toBe(true);
    const verifyParams: FalconParams = { name: "Falcon-1024", publicKey: buf(pub) };
    expect(await subtle.verify(verifyParams, publicKey, signature, message)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await subtle.verify(verifyParams, publicKey, signature, tampered)).toBe(false);
  });

  it("requires a seed to generate a key", async () => {
    await expect(subtle.generateKey({ name: "Falcon-1024" }, false, ["sign"])).rejects.toThrow();
  });

  it("never moves raw material across the public surface", async () => {
    await expect(
      subtle.importKey("raw", buf(new Uint8Array(4)), { name: "Falcon-1024" }, true, ["sign"]),
    ).rejects.toBeInstanceOf(MaterialAccessError);
    const handle = createKeyHandle("private", { name: "Falcon-1024" }, true, ["sign"]);
    await expect(subtle.exportKey("raw", handle)).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("requires the private key in the sign parameters", async () => {
    const handle = createKeyHandle("private", { name: "Falcon-1024" }, false, ["sign"]);
    await expect(subtle.sign({ name: "Falcon-1024" }, handle, message)).rejects.toBeInstanceOf(
      MaterialAccessError,
    );
  });

  it("delegates unknown algorithms to the host", async () => {
    const pair = (await subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const signature = await subtle.sign({ name: "Ed25519" }, pair.privateKey, message);
    expect(await subtle.verify({ name: "Ed25519" }, pair.publicKey, signature, message)).toBe(true);
  });
});

describe("withSubtleXHD", () => {
  const subtle = withSubtleXHD(host, xhd);
  const bip44Path = [harden(44), harden(283), harden(0), 0, 0];
  let rootKey: Uint8Array;

  beforeAll(() => {
    rootKey = fromSeed(Buffer.from(new Uint8Array(32).fill(7)));
  });

  it("signs with a per-operation root key and verifies with the derived public key", async () => {
    const signHandle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
    // A fresh root-key copy is injected per operation because `sign`/`deriveBits`
    // wipe the root they consume, so the injected secret does not linger.
    const signRoot = buf(Uint8Array.from(rootKey));
    const signParams: XHDParams = {
      name: "BIP32-Ed25519",
      bip44Path,
      derivationType: BIP32DerivationType.Peikert,
      rootKey: signRoot,
    };

    const signature = await subtle.sign(signParams, signHandle, message);
    expect(signature.byteLength).toBe(64);
    // The root key handed to `sign` was zeroed once signing completed.
    expect((signRoot as Uint8Array).every((b) => b === 0)).toBe(true);

    const deriveParams: XHDParams = {
      name: "BIP32-Ed25519",
      bip44Path,
      derivationType: BIP32DerivationType.Peikert,
      rootKey: buf(Uint8Array.from(rootKey)),
    };
    const derived = new Uint8Array(
      (await subtle.deriveBits(deriveParams, signHandle)) as ArrayBuffer,
    );
    const publicKey = derived.subarray(0, 32);

    // Verification is pure: it needs only the (public) derived key, no root key.
    const verifyHandle = createKeyHandle("public", { name: "BIP32-Ed25519" }, true, ["verify"]);
    const verifyParams: XHDParams = {
      name: "BIP32-Ed25519",
      bip44Path,
      publicKey: buf(publicKey),
    };
    expect(
      await subtle.verify(verifyParams, verifyHandle, new Uint8Array(signature), message),
    ).toBe(true);
  });

  it("generates a root key that carries material for the storage engine", async () => {
    const seed = new Uint8Array(32).fill(5);
    // The expected root is computed before generation, since generation wipes
    // the seed it consumes.
    const expectedRoot = fromSeed(Buffer.from(seed));
    const genRoot: XHDParams = { name: "BIP32-Ed25519", bip44Path, seed: buf(seed) };
    const root = (await subtle.generateKey(genRoot, false, ["sign"])) as CryptoKey;

    expect(root.type).toBe("private");
    expect(root.algorithm.name).toBe("BIP32-Ed25519");
    // The injected seed is zeroed once the root has been derived from it.
    expect(seed.every((b) => b === 0)).toBe(true);

    // The persisted root matches deriving it straight from the seed, and after
    // the storage engine consumes it the plaintext is wiped and unreadable.
    let rootRef: Uint8Array | undefined;
    const material = consumeKeyMaterial(root, (m) => {
      rootRef = m;
      return Uint8Array.from(m);
    });
    expect(material).toBeInstanceOf(Uint8Array);
    expect(material).toEqual(expectedRoot);
    expect(rootRef?.every((b) => b === 0)).toBe(true);
    expect(() => consumeKeyMaterial(root, (m) => m)).toThrow(MaterialAccessError);
  });

  it("derives a metadata-only key handle recording the path", async () => {
    const root = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
    const deriveParams: XHDParams = {
      name: "BIP32-Ed25519",
      bip44Path,
      derivationType: BIP32DerivationType.Peikert,
    };
    const derived = await subtle.deriveKey(deriveParams, root, { name: "BIP32-Ed25519" }, false, [
      "sign",
    ]);

    expect(derived.type).toBe("private");
    // The derived handle records the path (metadata), and carries no material.
    const derivedAlgorithm = derived.algorithm as unknown as { bip44Path: number[] };
    expect(derivedAlgorithm.bip44Path).toEqual(bip44Path);
    expect(() => consumeKeyMaterial(derived, (m) => m)).toThrow(MaterialAccessError);

    // It is treated like an ordinary key: signing re-derives from the root
    // (supplied by the storage engine) along the recorded path.
    const signParams: XHDParams = {
      name: "BIP32-Ed25519",
      bip44Path: derivedAlgorithm.bip44Path,
      rootKey: buf(Uint8Array.from(rootKey)),
    };
    const signature = await subtle.sign(signParams, derived, message);
    expect(signature.byteLength).toBe(64);
  });

  it("never moves raw material across the public surface", async () => {
    await expect(
      subtle.importKey("raw", buf(rootKey), { name: "BIP32-Ed25519" }, false, ["sign"]),
    ).rejects.toBeInstanceOf(MaterialAccessError);
    const handle = createKeyHandle("private", { name: "BIP32-Ed25519" }, true, ["sign"]);
    await expect(subtle.exportKey("raw", handle)).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("requires the root key in the sign parameters", async () => {
    const handle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
    const params: XHDParams = { name: "BIP32-Ed25519", bip44Path };
    await expect(subtle.sign(params, handle, message)).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("delegates unknown algorithms to the host", async () => {
    const digest = await subtle.digest("SHA-256", message);
    expect(digest.byteLength).toBe(32);
  });
});

describe("withSubtleDP256", () => {
  const subtle = withSubtleDP256(host, dp256);
  const entropy = new Uint8Array(16).fill(4);
  const descriptor = { origin: "https://example.com", userHandle: "user-123" };
  // Use a low PBKDF2 iteration count throughout so the tests stay fast; the shim
  // signs/derives from whatever main key it is handed, so the count only affects
  // the main-key value, not correctness.
  const genParams = (): DP256Params => ({
    name: "Deterministic-P256",
    entropy: buf(Uint8Array.from(entropy)),
    iterationCount: 32,
  });

  let mainKey: Uint8Array;
  beforeAll(async () => {
    mainKey = await dp256api.genDerivedMainKey(entropy, new TextEncoder().encode("liquid"), 32, 64);
  });

  it("generates a main key that carries material for the storage engine", async () => {
    const entropyCopy = Uint8Array.from(entropy);
    const params: DP256Params = {
      name: "Deterministic-P256",
      entropy: buf(entropyCopy),
      iterationCount: 32,
    };
    const main = (await subtle.generateKey(params, false, ["sign"])) as CryptoKey;

    expect(main.type).toBe("private");
    expect(main.algorithm.name).toBe("Deterministic-P256");
    // The injected entropy is zeroed once the main key has been derived from it.
    expect(entropyCopy.every((b) => b === 0)).toBe(true);

    // The persisted main key matches deriving it straight from the entropy, and
    // after the storage engine consumes it the plaintext is wiped and unreadable.
    let ref: Uint8Array | undefined;
    const material = consumeKeyMaterial(main, (m) => {
      ref = m;
      return Uint8Array.from(m);
    });
    expect(material).toEqual(mainKey);
    expect(ref?.every((b) => b === 0)).toBe(true);
    expect(() => consumeKeyMaterial(main, (m) => m)).toThrow(MaterialAccessError);

    // Generation is deterministic (recoverable from a mnemonic).
    const again = (await subtle.generateKey(genParams(), false, ["sign"])) as CryptoKey;
    expect(consumeKeyMaterial(again, (m) => Uint8Array.from(m))).toEqual(mainKey);
  });

  it("derives a metadata-only passkey handle recording the domain descriptor", async () => {
    const main = createKeyHandle("private", { name: "Deterministic-P256" }, false, ["sign"]);
    const derived = await subtle.deriveKey(
      { name: "Deterministic-P256", ...descriptor },
      main,
      { name: "Deterministic-P256" },
      false,
      ["sign"],
    );

    expect(derived.type).toBe("private");
    const algorithm = derived.algorithm as unknown as {
      origin: string;
      userHandle: string;
      counter: number;
    };
    expect(algorithm.origin).toBe(descriptor.origin);
    expect(algorithm.userHandle).toBe(descriptor.userHandle);
    expect(algorithm.counter).toBe(0);
    // The derived handle carries no material — it is re-derived at sign time.
    expect(() => consumeKeyMaterial(derived, (m) => m)).toThrow(MaterialAccessError);
  });

  it("signs by re-deriving the domain key and verifies with the host's ECDSA", async () => {
    const handle = createKeyHandle("private", { name: "Deterministic-P256" }, false, ["sign"]);
    // A fresh main-key copy is injected per op because sign wipes what it consumes.
    const signMain = buf(Uint8Array.from(mainKey));
    const signParams: DP256Params = {
      name: "Deterministic-P256",
      ...descriptor,
      mainKey: signMain,
    };
    const signature = await subtle.sign(signParams, handle, message);
    expect(signature.byteLength).toBe(64);
    // The injected main key was zeroed once signing completed.
    expect((signMain as Uint8Array).every((b) => b === 0)).toBe(true);

    // The (non-secret) public key comes from the public deriveBits path.
    const deriveParams: DP256Params = {
      name: "Deterministic-P256",
      ...descriptor,
      mainKey: buf(Uint8Array.from(mainKey)),
    };
    const publicKey = new Uint8Array(
      (await subtle.deriveBits(deriveParams, handle)) as ArrayBuffer,
    );
    expect(publicKey.length).toBe(64);

    const verifyParams: DP256Params = { name: "Deterministic-P256", publicKey: buf(publicKey) };
    const verifyHandle = createKeyHandle("public", { name: "Deterministic-P256" }, true, [
      "verify",
    ]);
    expect(
      await subtle.verify(verifyParams, verifyHandle, new Uint8Array(signature), message),
    ).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(
      await subtle.verify(verifyParams, verifyHandle, new Uint8Array(signature), tampered),
    ).toBe(false);
  });

  it("never moves raw material across the public surface", async () => {
    await expect(
      subtle.importKey("raw", buf(new Uint8Array(32)), { name: "Deterministic-P256" }, false, [
        "sign",
      ]),
    ).rejects.toBeInstanceOf(MaterialAccessError);
    const handle = createKeyHandle("private", { name: "Deterministic-P256" }, true, ["sign"]);
    await expect(subtle.exportKey("raw", handle)).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("requires the main key in the sign parameters", async () => {
    const handle = createKeyHandle("private", { name: "Deterministic-P256" }, false, ["sign"]);
    await expect(
      subtle.sign({ name: "Deterministic-P256", ...descriptor }, handle, message),
    ).rejects.toBeInstanceOf(MaterialAccessError);
  });

  it("requires entropy to generate a main key", async () => {
    await expect(
      subtle.generateKey({ name: "Deterministic-P256" }, false, ["sign"]),
    ).rejects.toThrow();
  });

  it("delegates unknown algorithms to the host", async () => {
    const digest = await subtle.digest("SHA-256", message);
    expect(digest.byteLength).toBe(32);
  });
});

describe("withSubtleDerivedMainKey", () => {
  const entropy = new Uint8Array(16).fill(4);
  const salt = new TextEncoder().encode("liquid");

  it("derives the main key through the host's PBKDF2, byte-identical to the binding", async () => {
    const viaSubtle = await genDerivedMainKeyWithSubtle(
      host,
      Uint8Array.from(entropy),
      salt,
      32,
      64,
    );
    const viaBinding = await dp256api.genDerivedMainKey(entropy, salt, 32, 64);
    expect(viaSubtle).toEqual(viaBinding);
  });

  it("leaves the caller's entropy view untouched (the caller wipes it)", async () => {
    const entropyCopy = Uint8Array.from(entropy);
    await genDerivedMainKeyWithSubtle(host, entropyCopy, salt, 32, 64);
    expect(entropyCopy).toEqual(entropy);
  });

  it("prefers the host derivation and passes every other operation through", async () => {
    let bindingCalls = 0;
    const decorated = withSubtleDerivedMainKey(host, {
      ...dp256,
      genDerivedMainKey: (e, s, iterationCount, keyLengthBytes) => {
        bindingCalls += 1;
        return dp256.genDerivedMainKey(e, s, iterationCount, keyLengthBytes);
      },
    });

    const mainKey = await decorated.genDerivedMainKey(Uint8Array.from(entropy), salt, 32, 64);
    expect(bindingCalls).toBe(0);
    expect(mainKey).toEqual(await dp256api.genDerivedMainKey(entropy, salt, 32, 64));
    // Only the main-key derivation is decorated; the single-step operations
    // still go straight to the binding.
    expect(decorated.genDomainSpecificKeyPair).toBe(dp256.genDomainSpecificKeyPair);
    expect(decorated.signWithDomainSpecificKeyPair).toBe(dp256.signWithDomainSpecificKeyPair);
    expect(decorated.getPurePKBytes).toBe(dp256.getPurePKBytes);
  });

  it("falls back to the binding when the host Subtle lacks PBKDF2", async () => {
    // WebCrypto leaves per-algorithm support implementation-defined; a host
    // without PBKDF2 rejects the base-key import.
    const noPBKDF2 = {
      importKey: async () => {
        throw new Error("PBKDF2 is not supported");
      },
    } as unknown as SubtleCrypto;

    const decorated = withSubtleDerivedMainKey(noPBKDF2, dp256);
    const mainKey = await decorated.genDerivedMainKey(Uint8Array.from(entropy), salt, 32, 64);
    expect(mainKey).toEqual(await dp256api.genDerivedMainKey(entropy, salt, 32, 64));
  });
});

describe("composition", () => {
  it("stacks both decorators over a single host", async () => {
    const subtle = withSubtleFalcon1024(withSubtleXHD(host, xhd), falcon);

    // Falcon path
    const { privateKey, publicKey } = falcon.generateKey();
    const falconSignHandle = createKeyHandle("private", { name: "Falcon-1024" }, false, ["sign"]);
    const falconSignParams: FalconParams = { name: "Falcon-1024", privateKey: buf(privateKey) };
    const falconSig = await subtle.sign(falconSignParams, falconSignHandle, message);
    const falconVerifyHandle = createKeyHandle("public", { name: "Falcon-1024" }, true, ["verify"]);
    const falconVerifyParams: FalconParams = { name: "Falcon-1024", publicKey: buf(publicKey) };
    expect(await subtle.verify(falconVerifyParams, falconVerifyHandle, falconSig, message)).toBe(
      true,
    );

    // XHD path
    const rootKey = fromSeed(Buffer.from(new Uint8Array(32).fill(3)));
    const xhdHandle = createKeyHandle("private", { name: "BIP32-Ed25519" }, false, ["sign"]);
    const bip44Path = [harden(44), harden(283), harden(0), 0, 0];
    const xhdParams: XHDParams = { name: "BIP32-Ed25519", bip44Path, rootKey: buf(rootKey) };
    const xhdSig = await subtle.sign(xhdParams, xhdHandle, message);
    expect(xhdSig.byteLength).toBe(64);

    // Host path still works
    const digest = await subtle.digest("SHA-256", message);
    expect(digest.byteLength).toBe(32);
  });
});
