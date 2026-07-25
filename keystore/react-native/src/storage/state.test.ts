import type { KeyData, KeyStoreState } from "@algorandfoundation/keystore-core";
import { base64url } from "@scure/base";
import { Store } from "@tanstack/store";
import * as Keychain from "react-native-keychain";
import { beforeEach, describe, expect, it } from "vitest";
import { MasterKeyNotFoundError } from "../errors.js";
import { commit, decode, encode, fetchSecret, storage } from "./state.js";

describe("state storage", () => {
  beforeEach(async () => {
    storage.clearAll();
    await Keychain.resetGenericPassword();
  });

  it("should commit and fetch a secret", async () => {
    const store = new Store<KeyStoreState>({
      keys: [],
      status: "idle",
      version: "1.0.0",
    });

    const keyData: KeyData = {
      id: "test-key",
      name: "Test Key",
      // Example of "real" seed data: 32-byte Ed25519 seed
      publicKey: new Uint8Array([
        184, 137, 168, 145, 12, 185, 41, 4, 184, 137, 168, 145, 12, 185, 41, 4, 184, 137, 168, 145,
        12, 185, 41, 4, 184, 137, 168, 145, 12, 185, 41, 4,
      ]),
      privateKey: new Uint8Array([
        42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42,
        42, 42, 42, 42, 42, 42, 42, 42, 42,
      ]),
      type: "ed25519",
    } as any;

    await commit({ store, keyData });

    // Check store update
    expect(store.state.keys.length).toBe(1);
    expect(store.state.keys[0].id).toBe("test-key");

    // Check persistent storage
    const stored = storage.getString("test-key");
    expect(stored).toBeDefined();

    // Fetch back
    const fetched = await fetchSecret<KeyData>({ keyId: "test-key" });
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe("test-key");
    expect(fetched?.privateKey).toEqual(
      new Uint8Array([
        42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42,
        42, 42, 42, 42, 42, 42, 42, 42, 42,
      ]),
    );
  });

  it("does not create a replacement master key when encrypted storage already exists", async () => {
    storage.set("existing-key", "encrypted-with-another-master-key");

    await expect(fetchSecret<KeyData>({ keyId: "existing-key" })).rejects.toBeInstanceOf(
      MasterKeyNotFoundError,
    );
  });
});

describe("encode/decode serialization", () => {
  const keyData = {
    id: "k",
    type: "ed25519",
    publicKey: new Uint8Array([1, 2, 3, 4]),
    privateKey: new Uint8Array([9, 8, 7, 6, 5]),
  } as unknown as KeyData;

  it("round-trips through the unified $u8 codec", () => {
    const encoded = encode(keyData);
    // The new format is plain JSON with `{ $u8: base64 }` byte wrappers.
    expect(encoded.startsWith("{")).toBe(true);
    expect(encoded).toContain("$u8");

    const decoded = decode(encoded) as any;
    expect(decoded.id).toBe("k");
    expect(decoded.publicKey).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(decoded.privateKey).toEqual(new Uint8Array([9, 8, 7, 6, 5]));
  });

  it("still decodes a legacy base64url + number-array payload for transparent migration", () => {
    // Reproduce the pre-unification `encode`: base64url(utf8(JSON)) where byte
    // fields were serialized as plain number arrays.
    const legacyJson = JSON.stringify({
      id: "k",
      type: "ed25519",
      publicKey: Array.from(keyData.publicKey as Uint8Array),
      privateKey: Array.from((keyData as any).privateKey as Uint8Array),
    });
    const legacy = base64url.encode(new TextEncoder().encode(legacyJson));

    const decoded = decode(legacy) as any;
    expect(decoded.id).toBe("k");
    expect(decoded.publicKey).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(decoded.privateKey).toEqual(new Uint8Array([9, 8, 7, 6, 5]));
  });
});
