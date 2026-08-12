import { describe, expect, it } from "vitest";
import { DEFAULT_LEDGER_KEY, keyValueLedger, memoryLedger } from "./ledger.ts";
import type { KeyValueStore, Revision } from "./types.ts";

const revision: Revision = { id: 2, name: "second", appliedAt: "2026-01-01T00:00:00.000Z" };

/** A synchronous in-memory {@link KeyValueStore}, like MMKV or localStorage. */
function syncStore(
  seed: Record<string, string> = {},
): KeyValueStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    get: (key) => raw.get(key),
    set: (key, value) => {
      raw.set(key, value);
    },
  };
}

/** An asynchronous {@link KeyValueStore}, like AsyncStorage. */
function asyncStore(): KeyValueStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get: (key) => Promise.resolve(raw.get(key) ?? null),
    set: async (key, value) => {
      raw.set(key, value);
    },
  };
}

describe("memoryLedger", () => {
  it("starts empty", async () => {
    expect(await memoryLedger().read()).toEqual({});
  });

  it("reads back what was written", async () => {
    const ledger = memoryLedger();
    await ledger.write("@scope/pkg", revision);
    expect(await ledger.read()).toEqual({ "@scope/pkg": revision });
  });

  it("seeds from an initial map", async () => {
    const ledger = memoryLedger({ "@scope/pkg": revision });
    expect(await ledger.read()).toEqual({ "@scope/pkg": revision });
  });

  it("returns a snapshot that later writes do not mutate", async () => {
    const ledger = memoryLedger();
    const before = await ledger.read();
    await ledger.write("@scope/pkg", revision);
    expect(before).toEqual({});
  });
});

describe("keyValueLedger", () => {
  it("reads an absent key as an empty map", async () => {
    expect(await keyValueLedger(syncStore()).read()).toEqual({});
  });

  it("round-trips through a synchronous store", async () => {
    const kv = syncStore();
    const ledger = keyValueLedger(kv);

    await ledger.write("@scope/pkg", revision);

    expect(await ledger.read()).toEqual({ "@scope/pkg": revision });
    expect(kv.raw.has(DEFAULT_LEDGER_KEY)).toBe(true);
  });

  it("round-trips through an asynchronous store", async () => {
    const ledger = keyValueLedger(asyncStore());
    await ledger.write("@scope/pkg", revision);
    expect(await ledger.read()).toEqual({ "@scope/pkg": revision });
  });

  it("preserves other modules when writing one", async () => {
    const ledger = keyValueLedger(syncStore());
    await ledger.write("@scope/a", revision);
    await ledger.write("@scope/b", { id: 1, name: "first", appliedAt: "2026-01-02T00:00:00.000Z" });

    const state = await ledger.read();
    expect(Object.keys(state).sort()).toEqual(["@scope/a", "@scope/b"]);
    expect(state["@scope/a"]).toEqual(revision);
  });

  it("honours a custom storage key", async () => {
    const kv = syncStore();
    await keyValueLedger(kv, { key: "custom" }).write("@scope/pkg", revision);
    expect(kv.raw.has("custom")).toBe(true);
    expect(kv.raw.has(DEFAULT_LEDGER_KEY)).toBe(false);
  });

  it("reads corrupt JSON as empty rather than throwing", async () => {
    const kv = syncStore({ [DEFAULT_LEDGER_KEY]: "{not json" });
    expect(await keyValueLedger(kv).read()).toEqual({});
  });

  it("reads a non-object payload as empty", async () => {
    const kv = syncStore({ [DEFAULT_LEDGER_KEY]: "[1,2,3]" });
    expect(await keyValueLedger(kv).read()).toEqual({});
  });
});
