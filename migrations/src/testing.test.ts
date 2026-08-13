import { describe, expect, it } from "vitest";
import { assertIdempotent } from "./testing.ts";
import type { Migration } from "./types.ts";

/** A trivial record store standing in for a real storage context. */
type Store = { records: Record<string, number> };

describe("assertIdempotent", () => {
  it("passes for a migration that converges", async () => {
    const migration: Migration<Store> = {
      id: 1,
      name: "set-flag",
      up: (store) => {
        for (const key of Object.keys(store.records)) {
          store.records[key] = 1;
        }
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: { a: 0, b: 0 } }),
        snapshot: (store) => store.records,
      }),
    ).resolves.toBeUndefined();
  });

  it("passes for a migration that is a no-op on empty data", async () => {
    const migration: Migration<Store> = { id: 1, name: "noop", up: () => undefined };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: {} }),
        snapshot: (store) => store.records,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws for a migration that accumulates on every run", async () => {
    const migration: Migration<Store> = {
      id: 1,
      name: "increment",
      up: (store) => {
        for (const key of Object.keys(store.records)) {
          store.records[key] = (store.records[key] ?? 0) + 1;
        }
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: { a: 0 } }),
        snapshot: (store) => store.records,
      }),
    ).rejects.toThrow(/not idempotent/);
  });

  it("names the migration in the failure message", async () => {
    const migration: Migration<Store> = {
      id: 3,
      name: "double",
      up: (store) => {
        store.records["a"] = (store.records["a"] ?? 1) * 2;
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: { a: 1 } }),
        snapshot: (store) => store.records,
      }),
    ).rejects.toThrow(/"double".*3|3.*"double"/s);
  });

  it("ignores object key ordering", async () => {
    const migration: Migration<{ value: Record<string, number> }> = {
      id: 1,
      name: "reorder",
      up: (ctx) => {
        // Rewrites the same data with the keys inserted in the opposite order.
        ctx.value = Object.fromEntries(Object.entries(ctx.value).reverse());
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ value: { a: 1, b: 2 } }),
        snapshot: (ctx) => ctx.value,
      }),
    ).resolves.toBeUndefined();
  });

  it("renders Uint8Array snapshots via Array.from, not the generic object branch", async () => {
    // Non-idempotent by construction: every run shifts every byte up by one,
    // so the two runs are guaranteed to differ and `assertIdempotent` throws —
    // which lets us inspect exactly how it rendered the two snapshots.
    //
    // This is deliberately not just "does assertIdempotent report a
    // difference" — plain equality of two Uint8Arrays with different content
    // is detected identically whether or not `normalise` special-cases
    // `Uint8Array` (both a JSON array and a JSON object rendering of the same
    // byte sequence differ from each other as strings). What only the
    // `instanceof Uint8Array` branch guarantees is the *rendering itself*:
    // `Array.from` first (`[6,\n  7]`), never the generic keyed-object
    // fallback (`{"0":6,"1":7}`) that a `Uint8Array` would otherwise hit
    // (typed arrays are plain objects with own enumerable index keys).
    const migration: Migration<{ bytes: Uint8Array }> = {
      id: 1,
      name: "increment",
      up: (ctx) => {
        ctx.bytes = ctx.bytes.map((b) => b + 1);
      },
    };

    let error: Error | undefined;
    try {
      await assertIdempotent({
        migration,
        context: () => ({ bytes: new Uint8Array([5, 6]) }),
        snapshot: (ctx) => ctx.bytes,
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("[\n  6,\n  7\n]");
    expect(error!.message).not.toContain('"0":');
  });

  it("supports an async snapshot and an async up", async () => {
    const migration: Migration<Store> = {
      id: 1,
      name: "async-noop",
      up: async () => undefined,
    };

    await expect(
      assertIdempotent({
        migration,
        context: async () => ({ records: {} }),
        snapshot: async (store) => store.records,
      }),
    ).resolves.toBeUndefined();
  });

  it("supplies a working scratch to each run", async () => {
    const migration: Migration<Store> = {
      id: 1,
      name: "uses-scratch",
      up: async (_store, utils) => {
        utils.secrets.put("seed", new Uint8Array([1]));
        await utils.secrets.use("seed", (bytes) => bytes.length);
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: {} }),
        snapshot: (store) => store.records,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws a clear error when `snapshot` returns undefined", async () => {
    // A snapshot callback that forgets its `return` (e.g. `(s) => { dump(s); }`)
    // yields `undefined`; `JSON.stringify(undefined) === undefined` on every
    // run, so without this check the comparison would pass vacuously no
    // matter what the migration does.
    const migration: Migration<Store> = {
      id: 1,
      name: "doubles-every-record",
      up: (store) => {
        for (const key of Object.keys(store.records)) {
          store.records[key] = (store.records[key] ?? 0) * 2;
        }
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ records: { a: 1 } }),
        snapshot: () => {
          // Deliberately missing `return` — the bug under test.
        },
      }),
    ).rejects.toThrow(/snapshot.*undefined|undefined.*return/is);
  });

  it("throws a clear error, naming Map, when the snapshot contains a Map", async () => {
    await expect(
      assertIdempotent({
        migration: { id: 1, name: "noop", up: () => undefined },
        context: () => ({ map: new Map([["a", 1]]) }),
        snapshot: (ctx) => ctx.map,
      }),
    ).rejects.toThrow(/\bMap\b/);
  });

  it("throws a clear error, naming Set, when the snapshot contains a Set", async () => {
    await expect(
      assertIdempotent({
        migration: { id: 1, name: "noop", up: () => undefined },
        context: () => ({ set: new Set([1, 2]) }),
        snapshot: (ctx) => ctx.set,
      }),
    ).rejects.toThrow(/\bSet\b/);
  });

  it("reports a doubling migration as non-idempotent even though its snapshot is a Map", async () => {
    // Before the fix: `normalise` fell into the plain-object branch for a
    // `Map`, whose `Object.keys()` sees none of its entries, so both runs
    // stringified to "{}" and this doubling migration passed vacuously.
    const migration: Migration<{ map: Map<string, number> }> = {
      id: 1,
      name: "double",
      up: (ctx) => {
        for (const [key, value] of ctx.map) {
          ctx.map.set(key, value * 2);
        }
      },
    };

    await expect(
      assertIdempotent({
        migration,
        context: () => ({ map: new Map([["a", 1]]) }),
        snapshot: (ctx) => ctx.map,
      }),
    ).rejects.toThrow(); // no longer resolves — the Map is rejected outright, not silently treated as `{}`
  });
});
