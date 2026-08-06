import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import { Store } from "@tanstack/store";
import * as falcon from "falcon-1024";
import { describe, expect, it } from "vitest";

import { createReactNativeKeyStore } from "./engine.ts";
import { createFalconBinding, type ReactNativeFalconModule } from "./falcon.ts";
import type { KeychainStorage } from "./storage/driver.ts";

const message = new TextEncoder().encode("the quick brown fox");
const subtle = globalThis.crypto.subtle;

/** Copies a `Uint8Array` into a fresh `ArrayBuffer`. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * A stand-in for the `@joe-p/react-native-falcon` native `FalconModule`, backed by the
 * WASM `falcon-1024` module but exposing the *native* surface: `ArrayBuffer`
 * in/out and a `verify` that **throws** on an invalid signature. This is exactly
 * the shape {@link createFalconBinding} must adapt, so exercising the binding
 * against it proves the ArrayBuffer<->Uint8Array conversion and the
 * throw->boolean translation without needing the real device module.
 */
const nativeModule: ReactNativeFalconModule = {
  generateKey: (seed?: ArrayBuffer) => {
    const pair = falcon.generateKey(seed ? new Uint8Array(seed) : undefined);
    return { publicKey: toArrayBuffer(pair.publicKey), privateKey: toArrayBuffer(pair.privateKey) };
  },
  signCompressed: (privateKey: ArrayBuffer, msg: ArrayBuffer) =>
    toArrayBuffer(falcon.signCompressed(new Uint8Array(privateKey), new Uint8Array(msg))),
  verify: (publicKey: ArrayBuffer, signature: ArrayBuffer, msg: ArrayBuffer) => {
    if (
      !falcon.verifyCompressed(
        new Uint8Array(publicKey),
        new Uint8Array(signature),
        new Uint8Array(msg),
      )
    ) {
      throw new Error("invalid Falcon signature");
    }
  },
};

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

describe("createFalconBinding (@joe-p/react-native-falcon adapter)", () => {
  const binding = createFalconBinding(nativeModule);

  it("generates a keypair as Uint8Arrays and round-trips sign/verify", () => {
    const seed = new Uint8Array(48).fill(9);
    const { publicKey, privateKey } = binding.generateKey(seed);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toBeInstanceOf(Uint8Array);

    const signature = binding.signCompressed(privateKey, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.byteLength).toBeGreaterThan(0);

    expect(binding.verifyCompressed(publicKey, signature, message)).toBe(true);
  });

  it("translates the native throw-on-invalid into a boolean false", () => {
    const { publicKey, privateKey } = binding.generateKey(new Uint8Array(48).fill(3));
    const signature = binding.signCompressed(privateKey, message);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    // The native module throws for a bad signature; the binding must return false.
    expect(binding.verifyCompressed(publicKey, tampered, signature)).toBe(false);
    expect(binding.verifyCompressed(publicKey, signature, tampered)).toBe(false);
  });

  it("is deterministic for a given seed", () => {
    const seed = new Uint8Array(48).fill(7);
    const a = binding.generateKey(seed);
    const b = binding.generateKey(seed);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.privateKey).toEqual(b.privateKey);
  });
});

describe("createReactNativeKeyStore with a native Falcon binding", () => {
  it("enables Falcon-1024 in the default shim set (generate → sign/verify)", async () => {
    const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
    const storage = memoryStorage();
    // No explicit `shims`: the engine builds the default set and folds in the
    // injected native Falcon binding (the @joe-p/react-native-falcon path).
    const keystore = createReactNativeKeyStore({
      store,
      subtle,
      storage,
      falcon: createFalconBinding(nativeModule),
    });
    await keystore.ready;

    const id = await keystore.generate({
      type: "falcon-1024",
      algorithm: "Falcon-1024",
      extractable: false,
      keyUsages: ["sign", "verify"],
      params: { seed: new Uint8Array(48).fill(9) },
    });
    const meta = store.state.keys.find((k) => k.id === id);
    expect(meta?.type).toBe("falcon-1024");
    expect(meta?.algorithm).toBe("Falcon-1024");
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);
    // Material is sealed at rest under the material prefix.
    expect(storage.getString(`m/${id}`)).toBeDefined();

    const signature = await keystore.sign(id, message);
    expect(signature.byteLength).toBeGreaterThan(0);
    expect(await keystore.verify(id, message, signature)).toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await keystore.verify(id, tampered, signature)).toBe(false);
  });
});
