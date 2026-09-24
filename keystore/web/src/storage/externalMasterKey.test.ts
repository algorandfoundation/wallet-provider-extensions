import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createIndexedDBDriver } from "./driver.ts";
import { MASTER_KEY_ID } from "./vault.ts";
import { MATERIAL_STORE, openDatabase } from "./db.ts";
import { KeyStoreError, type KeyId } from "@algorandfoundation/keystore-core";

// Staged for an `UnlockingError` in keystore-core: until it lands, the driver
// raises a `KeyStoreError` carrying that name.
async function expectUnlockingError(pending: Promise<unknown>): Promise<void> {
  await expect(pending).rejects.toThrow(KeyStoreError);
  await expect(pending).rejects.toHaveProperty("name", "UnlockingError");
}

describe("IndexedDBDriver with an external master key", () => {
  let host: SubtleCrypto;
  let dbCounter = 0;
  let databaseName: string;
  let external: CryptoKey;
  let calls: number;
  let masterKey: () => Promise<CryptoKey>;

  beforeEach(async () => {
    host = globalThis.crypto.subtle;
    databaseName = `test-external-master-${dbCounter++}`;
    external = await host.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    calls = 0;
    masterKey = () => {
      calls++;
      return Promise.resolve(external);
    };
  });

  const id = "external-key" as KeyId;

  it("never mints or persists the reserved master record", async () => {
    const driver = createIndexedDBDriver({ host, databaseName, masterKey });
    await driver.ready;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) });

    const db = await openDatabase(databaseName, globalThis.indexedDB);
    await expect(db.get(MATERIAL_STORE, MASTER_KEY_ID)).resolves.toBeUndefined();
    db.close();
  });

  it("binds material to the supplied key and to nothing else", async () => {
    const other = await host.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const driver = createIndexedDBDriver({ host, databaseName, masterKey });
    await driver.ready;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([4, 5, 6]) });

    const wrongKey = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => Promise.resolve(other),
    });
    await wrongKey.ready;
    const opening = wrongKey.use(id, {}, () => undefined);
    await expectUnlockingError(opening);
    // AES-GCM cannot tell a wrong key from a damaged record; the host's own
    // verdict rides along as the cause.
    await expect(opening).rejects.toHaveProperty("cause.name", "OperationError");

    const rightKey = createIndexedDBDriver({ host, databaseName, masterKey });
    await rightKey.ready;
    await expect(
      rightKey.use(id, {}, (m) => (m.kind === "bytes" ? Array.from(m.bytes) : [])),
    ).resolves.toEqual([4, 5, 6]);
  });

  it("asks the provider once per operation rather than caching it", async () => {
    const driver = createIndexedDBDriver({ host, databaseName, masterKey });
    await driver.ready;
    expect(calls).toBe(0);

    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([7]) });
    expect(calls).toBe(1);

    await driver.use(id, {}, () => undefined);
    expect(calls).toBe(2);
  });

  it("surfaces a provider rejection and keeps `ready` usable afterwards", async () => {
    let unlocked = false;
    const driver = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => (unlocked ? Promise.resolve(external) : Promise.reject(new Error("locked"))),
    });
    await driver.ready;

    const bytes = new Uint8Array([8, 9]);
    await expect(driver.put(id, { kind: "bytes", bytes })).rejects.toThrow("locked");
    expect(Array.from(bytes)).toEqual([0, 0]);

    unlocked = true;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([8, 9]) });
    const reopened = await driver.use(id, {}, (m) =>
      m.kind === "bytes" ? Array.from(m.bytes) : [],
    );
    expect(reopened).toEqual([8, 9]);
  });

  it("reports nativeCryptoKey false, and true without a provider", async () => {
    const supplied = createIndexedDBDriver({ host, databaseName, masterKey });
    const vaultOwned = createIndexedDBDriver({ host, databaseName: `${databaseName}-own` });
    await Promise.all([supplied.ready, vaultOwned.ready]);

    expect(supplied.capabilities.nativeCryptoKey).toBe(false);
    expect(vaultOwned.capabilities.nativeCryptoKey).toBe(true);
  });

  it("rejects an open when the provider rejects", async () => {
    let unlocked = true;
    const driver = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => (unlocked ? Promise.resolve(external) : Promise.reject(new Error("locked"))),
    });
    await driver.ready;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([1]) });

    unlocked = false;
    await expect(driver.use(id, {}, () => undefined)).rejects.toThrow("locked");
  });

  it("passes a provider's own OperationError through rather than blaming the record", async () => {
    // A provider that unwraps its key under a wrong password rejects with an
    // `OperationError` of its own, which says nothing about the record.
    const sealer = createIndexedDBDriver({ host, databaseName, masterKey });
    await sealer.ready;
    await sealer.put(id, { kind: "bytes", bytes: new Uint8Array([1]) });

    const refusal = new DOMException("wrong password", "OperationError");
    const driver = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => Promise.reject(refusal),
    });
    await driver.ready;

    await expect(driver.use(id, {}, () => undefined)).rejects.toBe(refusal);
  });

  it.each<[string, AesKeyGenParams, KeyUsage[]]>([
    ["is not AES-GCM", { name: "AES-CBC", length: 256 }, ["encrypt", "decrypt"]],
    // The one that would otherwise get through: it seals material that no
    // key this provider hands back can open again.
    ["cannot decrypt", { name: "AES-GCM", length: 256 }, ["encrypt"]],
    ["cannot encrypt", { name: "AES-GCM", length: 256 }, ["decrypt"]],
  ])("refuses a supplied key that %s, sealing or opening", async (_, alg, usages) => {
    const sealer = createIndexedDBDriver({ host, databaseName, masterKey });
    await sealer.ready;
    await sealer.put(id, { kind: "bytes", bytes: new Uint8Array([1]) });

    const unfit = await host.generateKey(alg, false, usages);
    const driver = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => Promise.resolve(unfit),
    });
    await driver.ready;

    const bytes = new Uint8Array([1, 2, 3]);
    await expectUnlockingError(driver.put(id, { kind: "bytes", bytes }));
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    await expectUnlockingError(driver.use(id, {}, () => undefined));
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["raw key bytes", new Uint8Array(32)],
  ])("refuses a provider that resolves %s instead of a CryptoKey", async (_, resolved) => {
    const driver = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => Promise.resolve(resolved as CryptoKey),
    });
    await driver.ready;

    await expectUnlockingError(driver.put(id, { kind: "bytes", bytes: new Uint8Array([1]) }));
  });

  it("serves a pre-existing native CryptoKey record without the provider", async () => {
    // The limit the option carries, pinned: records an earlier release wrote
    // natively predate the provider and are returned untouched, so adopting
    // `masterKey` on such a database means re-importing those keys.
    const pair = await host.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const nativeId = "native-key" as KeyId;
    const legacy = createIndexedDBDriver({ host, databaseName });
    await legacy.ready;
    await legacy.put(nativeId, {
      kind: "cryptokey",
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    });

    const locked = createIndexedDBDriver({
      host,
      databaseName,
      masterKey: () => Promise.reject(new Error("locked")),
    });
    await locked.ready;

    await expect(locked.use(nativeId, {}, (m) => m.kind)).resolves.toBe("cryptokey");
  });

  it("cannot open byte material the default vault sealed", async () => {
    // The migration hazard, pinned: switching a provider on over a database
    // the vault wrote strands its sealed material, which is why adopting one
    // is a migration and not a flag.
    const legacy = createIndexedDBDriver({ host, databaseName });
    await legacy.ready;
    await legacy.put(id, { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) });

    const supplied = createIndexedDBDriver({ host, databaseName, masterKey });
    await supplied.ready;

    await expectUnlockingError(supplied.use(id, {}, () => undefined));
  });

  it("clears the vault's own master record once a provider owns the key", async () => {
    const vaultOwned = createIndexedDBDriver({ host, databaseName });
    await vaultOwned.ready;

    const supplied = createIndexedDBDriver({ host, databaseName, masterKey });
    await supplied.ready;
    await supplied.clear!();

    const db = await openDatabase(databaseName, globalThis.indexedDB);
    await expect(db.get(MATERIAL_STORE, MASTER_KEY_ID)).resolves.toBeUndefined();
    db.close();

    // The invariant the preserve list was added for still holds under a
    // provider: material written after a clear survives a reload.
    await supplied.put(id, { kind: "bytes", bytes: new Uint8Array([4, 5, 6]) });
    const reloaded = createIndexedDBDriver({ host, databaseName, masterKey });
    await reloaded.ready;
    await expect(
      reloaded.use(id, {}, (m) => (m.kind === "bytes" ? Array.from(m.bytes) : [])),
    ).resolves.toEqual([4, 5, 6]);
  });
});
