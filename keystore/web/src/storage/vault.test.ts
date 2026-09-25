import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDBDriver } from "./driver.ts";
import { MASTER_KEY_ID } from "./vault.ts";
import { MATERIAL_STORE, openDatabase } from "./db.ts";
import type { DriverMaterial, KeyId } from "@algorandfoundation/keystore-core";

/**
 * A minimal same-origin {@link LockManager}: `request` runs callbacks holding
 * the same name strictly one after another, which is the only property of Web
 * Locks the vault depends on.
 */
function stubLockManager(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async request(name: string, ...rest: unknown[]): Promise<unknown> {
      const callback = rest[rest.length - 1] as () => Promise<unknown>;
      const run = (tails.get(name) ?? Promise.resolve()).then(() => callback());
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
    query: async () => ({ held: [], pending: [] }),
  } as unknown as LockManager;
}

describe("vault master key creation", () => {
  let host: SubtleCrypto;
  let dbCounter = 0;
  let databaseName: string;

  beforeEach(() => {
    host = globalThis.crypto.subtle;
    databaseName = `test-master-key-${dbCounter++}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const id = "test-key" as KeyId;
  const material = (): DriverMaterial => ({ kind: "bytes", bytes: new Uint8Array([1, 2, 3, 4]) });
  const read = (driver: ReturnType<typeof createIndexedDBDriver>): Promise<number[]> =>
    driver.use(id, {}, (m) => {
      if (m.kind !== "bytes") throw new Error("expected byte material");
      return Array.from(m.bytes);
    });

  it("converges on one key when two contexts initialise concurrently", async () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: stubLockManager() });

    const first = createIndexedDBDriver({ host, databaseName });
    const second = createIndexedDBDriver({ host, databaseName });
    await Promise.all([first.ready, second.ready]);

    await first.put(id, material());

    await expect(read(second)).resolves.toEqual([1, 2, 3, 4]);
  });

  it("seals and opens in both directions across concurrently built drivers", async () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: stubLockManager() });

    const first = createIndexedDBDriver({ host, databaseName });
    const second = createIndexedDBDriver({ host, databaseName });
    await Promise.all([first.ready, second.ready]);

    await second.put(id, material());

    await expect(read(first)).resolves.toEqual([1, 2, 3, 4]);
  });

  it("falls back to plain creation where no LockManager is exposed", async () => {
    // The fallback cannot make concurrent creation safe — only the re-read
    // runs — so this pins the sequential path the fallback does guarantee: one
    // key is minted and every later driver reuses it.
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: undefined });

    const first = createIndexedDBDriver({ host, databaseName });
    await first.ready;
    const second = createIndexedDBDriver({ host, databaseName });
    await second.ready;

    await first.put(id, material());
    await expect(read(second)).resolves.toEqual([1, 2, 3, 4]);

    const db = await openDatabase(databaseName, globalThis.indexedDB);
    const records = await db.getAll<{ id: string }>(MATERIAL_STORE);
    db.close();
    expect(records.filter((r) => r.id === MASTER_KEY_ID)).toHaveLength(1);
  });

  it("does not serialise unrelated databases on one lock", async () => {
    const held: string[] = [];
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      locks: {
        request: (name: string, callback: () => Promise<unknown>) => {
          held.push(name);
          return callback();
        },
      },
    });

    await createIndexedDBDriver({ host, databaseName }).ready;
    await createIndexedDBDriver({ host, databaseName: `${databaseName}-other` }).ready;

    expect(new Set(held).size).toBe(2);
  });
});
