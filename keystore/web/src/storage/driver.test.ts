import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createIndexedDBDriver } from "./driver.ts";
import { MASTER_KEY_ID } from "./vault.ts";
import { MATERIAL_STORE, openDatabase } from "./db.ts";
import type { DriverMaterial, KeyId } from "@algorandfoundation/keystore-core";

describe("IndexedDBDriver clear() regression", () => {
  let host: SubtleCrypto;
  let dbCounter = 0;
  let databaseName: string;

  beforeEach(() => {
    host = globalThis.crypto.subtle;
    databaseName = `test-clear-regression-${dbCounter++}`;
  });

  it("fails to open material written after clear() when reloaded (the bug)", async () => {
    const driver1 = createIndexedDBDriver({ host, databaseName });
    await driver1.ready;

    const id: KeyId = "test-key-1" as any;
    const material: DriverMaterial = { kind: "bytes", bytes: new Uint8Array([1, 2, 3, 4]) };

    // 1. Initial put works
    await driver1.put(id, material);

    // 2. Clear the driver
    await driver1.clear();

    // 3. Put new material after clear
    const id2: KeyId = "test-key-2" as any;
    const material2: DriverMaterial = { kind: "bytes", bytes: new Uint8Array([5, 6, 7, 8]) };
    await driver1.put(id2, material2);

    // 4. Fresh driver instance (simulating reload)
    const driver2 = createIndexedDBDriver({ host, databaseName });
    await driver2.ready;

    // 5. Try to use material2 with driver2
    // This should now SUCCEED
    const result = await driver2.use(id2, {}, (m) => {
      if (m.kind === "bytes") return Array.from(m.bytes);
      throw new Error("Wrong material kind");
    });
    expect(result).toEqual([5, 6, 7, 8]);
  });

  it("clear() removes user keys and metadata", async () => {
    const driver = createIndexedDBDriver({ host, databaseName });
    await driver.ready;

    const id: KeyId = "user-key" as any;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([1]) });
    // @ts-ignore
    await driver.putMeta({ id, type: "seed" });

    await driver.clear();

    const meta = await driver.listMeta();
    expect(meta).toHaveLength(0);

    await expect(driver.use(id, {}, () => {})).rejects.toThrow();
  });

  it("reserved master record is not reported by listMeta()", async () => {
    const driver = createIndexedDBDriver({ host, databaseName });
    await driver.ready;

    const meta = await driver.listMeta();
    expect(meta.find((m) => m.id === MASTER_KEY_ID)).toBeUndefined();
  });

  it("refuses to write, describe or remove the reserved master id", async () => {
    const driver = createIndexedDBDriver({ host, databaseName });
    await driver.ready;

    await expect(
      driver.put(MASTER_KEY_ID, { kind: "bytes", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/reserved/);
    // @ts-ignore - only `id` matters for the guard
    await expect(driver.putMeta({ id: MASTER_KEY_ID, type: "seed" })).rejects.toThrow(/reserved/);
    await expect(driver.remove!(MASTER_KEY_ID)).rejects.toThrow(/reserved/);

    // The vault survives the attempts: material written afterwards still opens
    // from a fresh driver over the same database.
    const id: KeyId = "after-attack" as any;
    await driver.put(id, { kind: "bytes", bytes: new Uint8Array([9, 9]) });
    const reloaded = createIndexedDBDriver({ host, databaseName });
    await reloaded.ready;
    const bytes = await reloaded.use(id, {}, (m) =>
      m.kind === "bytes" ? Array.from(m.bytes) : [],
    );
    expect(bytes).toEqual([9, 9]);
  });

  it("KeyStoreDatabase.getAll filters excluded IDs", async () => {
    const db = await openDatabase(databaseName, globalThis.indexedDB);
    await db.put(MATERIAL_STORE, { id: "a" });
    await db.put(MATERIAL_STORE, { id: "b" });
    await db.put(MATERIAL_STORE, { id: "c" });

    const all = await db.getAll<{ id: string }>(MATERIAL_STORE, ["b"]);
    expect(all.map((r) => r.id)).toEqual(["a", "c"]);
    db.close();
  });
});
