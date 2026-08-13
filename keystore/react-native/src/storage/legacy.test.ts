import type { KeyData } from "@algorandfoundation/keystore-core";
import { base64 } from "@scure/base";
import { createCipheriv } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { MasterKeyNotFoundError } from "../errors.ts";
import { memoryStorage } from "./__fixtures__.ts";
import { openData, sealData } from "./crypto.ts";
import { adoptLegacyRecords } from "./legacy.ts";
import { encode } from "./state.ts";

const subtle = globalThis.crypto.subtle;

/**
 * Seals `data` with the legacy `{iv, tag, content}` envelope (auth tag stored
 * separately, as `react-native-quick-crypto`'s old `createCipheriv` scheme did).
 */
function sealLegacyEnvelope(key: Buffer, data: string): string {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let content = cipher.update(data, "utf8", "base64");
  content += cipher.final("base64");
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    content,
  });
}

describe("adoptLegacyRecords", () => {
  const masterKey = Buffer.alloc(32, 5);
  // Mirrors the production `readMasterKey`, which always hands back a fresh
  // copy: `adoptLegacyRecords` zeroes the buffer it receives once it's done,
  // so a mock that returned the very same instance every call would corrupt
  // `masterKey` out from under the rest of a test.
  const masterKeyForRead = async () => Buffer.from(masterKey);

  it("adopts a flat legacy {iv,tag,content} record into k/+m/, keeping material openable", async () => {
    const storage = memoryStorage();
    const keyData: KeyData = {
      id: "legacy-1",
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      publicKey: new Uint8Array([1, 2, 3, 4]),
      privateKey: new Uint8Array([9, 8, 7, 6, 5]),
      version: 1,
    } as unknown as KeyData;
    storage.set("legacy-1", sealLegacyEnvelope(masterKey, encode(keyData)));

    const result = await adoptLegacyRecords({ storage, subtle, masterKeyForRead });

    expect(result.adopted).toEqual(["legacy-1"]);
    expect(result.skipped).toEqual([]);

    // The flat record is gone; the split pair exists instead.
    expect(storage.getString("legacy-1")).toBeUndefined();
    const metaRaw = storage.getString("k/legacy-1");
    expect(metaRaw).toBeDefined();
    const meta = JSON.parse(metaRaw as string);
    expect(meta.id).toBe("legacy-1");
    expect(meta.type).toBe("ed25519");
    expect(meta.privateKey).toBeUndefined();

    // Material is present and still openable, matching the original bytes.
    const sealedMaterial = storage.getString("m/legacy-1");
    expect(sealedMaterial).toBeDefined();
    const opened = await openData(subtle, masterKey, sealedMaterial as string);
    expect(base64.decode(opened)).toEqual(new Uint8Array([9, 8, 7, 6, 5]));
  });

  it("is idempotent: a second pass over already-adopted records is a no-op", async () => {
    const storage = memoryStorage();
    const keyData: KeyData = {
      id: "legacy-2",
      type: "seed",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      seed: new Uint8Array([1, 1, 1, 1]),
      version: 1,
    } as unknown as KeyData;
    storage.set("legacy-2", await sealData(subtle, masterKey, encode(keyData)));

    const first = await adoptLegacyRecords({ storage, subtle, masterKeyForRead });
    expect(first.adopted).toEqual(["legacy-2"]);

    const before = { k: storage.getString("k/legacy-2"), m: storage.getString("m/legacy-2") };
    const second = await adoptLegacyRecords({ storage, subtle, masterKeyForRead });
    expect(second.adopted).toEqual([]);
    expect(second.skipped).toEqual([]);
    // Nothing was rewritten on the no-op pass.
    expect(storage.getString("k/legacy-2")).toBe(before.k);
    expect(storage.getString("m/legacy-2")).toBe(before.m);
  });

  it("skips a corrupt/undecryptable flat record without deleting it or aborting the pass", async () => {
    const storage = memoryStorage();
    storage.set("corrupt", "{not valid sealed data}");

    const goodKeyData: KeyData = {
      id: "good",
      type: "seed",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      seed: new Uint8Array([4, 4, 4, 4]),
      version: 1,
    } as unknown as KeyData;
    storage.set("good", await sealData(subtle, masterKey, encode(goodKeyData)));

    const result = await adoptLegacyRecords({ storage, subtle, masterKeyForRead });

    expect(result.adopted).toEqual(["good"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe("corrupt");

    // The corrupt record is untouched, not removed.
    expect(storage.getString("corrupt")).toBe("{not valid sealed data}");
    expect(storage.getString("k/corrupt")).toBeUndefined();
    expect(storage.getString("m/corrupt")).toBeUndefined();
  });

  it("skips a record with no recoverable privateKey/seed material without deleting it", async () => {
    const storage = memoryStorage();
    // Simulates a native credential record protected by a biometric cipher
    // this package cannot open (no plain `privateKey`/`seed` field).
    const record = { id: "native-cred", type: "hd-derived-p256", privateKeyEnc: "opaque" };
    storage.set("native-cred", await sealData(subtle, masterKey, JSON.stringify(record)));

    const result = await adoptLegacyRecords({ storage, subtle, masterKeyForRead });

    expect(result.adopted).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe("native-cred");
    expect(storage.getString("native-cred")).toBeDefined();
  });

  it("requests no master key and migrates nothing when there are no flat records", async () => {
    const storage = memoryStorage();
    storage.set("k/already-migrated", JSON.stringify({ id: "already-migrated" }));
    storage.set("m/already-migrated", "sealed-material");

    const masterKeySpy = vi.fn(masterKeyForRead);
    const result = await adoptLegacyRecords({ storage, subtle, masterKeyForRead: masterKeySpy });

    expect(result).toEqual({ adopted: [], skipped: [] });
    expect(masterKeySpy).not.toHaveBeenCalled();
  });

  it("never treats the migrations ledger blob as a flat record", async () => {
    const storage = memoryStorage();
    // A key/value ledger pointed at this MMKV instance writes its revision map
    // under this well-known key; it must be neither adopted nor reported, and
    // must not trigger a master-key read on its own.
    storage.set(
      "@algorandfoundation/provider-migrations",
      JSON.stringify({ "@scope/pkg": { id: 1, name: "first", appliedAt: "now" } }),
    );

    const masterKeySpy = vi.fn(masterKeyForRead);
    const result = await adoptLegacyRecords({ storage, subtle, masterKeyForRead: masterKeySpy });

    expect(result).toEqual({ adopted: [], skipped: [] });
    expect(masterKeySpy).not.toHaveBeenCalled();
  });

  it("treats a missing master key as nothing-to-migrate when flat records exist but no master key was ever created", async () => {
    const storage = memoryStorage();
    storage.set("legacy-3", "some-sealed-blob");

    const result = await adoptLegacyRecords({
      storage,
      subtle,
      masterKeyForRead: async () => {
        throw new MasterKeyNotFoundError();
      },
    });

    expect(result).toEqual({ adopted: [], skipped: [] });
    // The flat record is left untouched — nothing was migrated.
    expect(storage.getString("legacy-3")).toBe("some-sealed-blob");
  });
});
