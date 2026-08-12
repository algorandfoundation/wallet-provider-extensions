import { describe, expect, it } from "vitest";
import Hook from "before-after-hook";
import {
  InvalidMigrationsError,
  MigrationFailedError,
  SecretScratchDisposedError,
} from "./errors.ts";
import { applyMigrations, validateMigrations } from "./apply.ts";
import { keyValueLedger, memoryLedger } from "./ledger.ts";
import type {
  KeyValueStore,
  Migration,
  MigrationLedger,
  MigrationModule,
  Revision,
} from "./types.ts";

/** Alias for the scratch captured out of a migration, for lifetime assertions. */
type MigrationUtilsCapture = Parameters<Migration<unknown>["up"]>[1]["secrets"];

/** Builds a no-op revision with the given id. */
function rev(id: number, name = `rev-${id}`): Migration<unknown> {
  return { id, name, up: () => undefined };
}

describe("validateMigrations", () => {
  it("accepts an empty manifest", () => {
    expect(() => validateMigrations([])).not.toThrow();
  });

  it("accepts strictly ascending ids", () => {
    expect(() => validateMigrations([rev(1), rev(2), rev(7)])).not.toThrow();
  });

  it("rejects a zero id", () => {
    expect(() => validateMigrations([rev(0)])).toThrow(InvalidMigrationsError);
  });

  it("rejects a negative id", () => {
    expect(() => validateMigrations([rev(-1)])).toThrow(InvalidMigrationsError);
  });

  it("rejects a non-integer id", () => {
    expect(() => validateMigrations([rev(1.5)])).toThrow(InvalidMigrationsError);
  });

  it("rejects duplicate ids", () => {
    expect(() => validateMigrations([rev(1), rev(1)])).toThrow(InvalidMigrationsError);
  });

  it("rejects out-of-order ids", () => {
    expect(() => validateMigrations([rev(2), rev(1)])).toThrow(InvalidMigrationsError);
  });

  it("names the module in the message", () => {
    expect(() => validateMigrations([rev(1), rev(1)], "@scope/pkg")).toThrow(/@scope\/pkg/);
  });
});

/** Records the order in which revisions ran, for ordering assertions. */
function recorder(): { order: string[]; rev: (id: number, module?: string) => Migration<unknown> } {
  const order: string[] = [];
  return {
    order,
    rev: (id, module = "m") => ({
      id,
      name: `rev-${id}`,
      up: () => {
        order.push(`${module}:${id}`);
      },
    }),
  };
}

/** Wraps a ledger, recording the sequence of writes as they happen. */
function tracingLedger(inner: MigrationLedger): {
  ledger: MigrationLedger;
  writes: { module: string; revision: Revision }[];
} {
  const writes: { module: string; revision: Revision }[] = [];
  return {
    writes,
    ledger: {
      read: () => inner.read(),
      async write(module, revision) {
        writes.push({ module, revision });
        await inner.write(module, revision);
      },
    },
  };
}

describe("applyMigrations", () => {
  it("applies every revision ascending from an empty ledger", async () => {
    const { order, rev } = recorder();
    const registry: MigrationModule<unknown>[] = [
      { module: "m", context: () => ({}), migrations: [rev(1), rev(2), rev(3)] },
    ];

    const report = await applyMigrations({ registry, ledger: memoryLedger() });

    expect(order).toEqual(["m:1", "m:2", "m:3"]);
    expect(report.applied.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(report.failed).toEqual([]);
  });

  it("resumes from the ledger, skipping applied revisions", async () => {
    const { order, rev } = recorder();
    const ledger = memoryLedger({
      m: { id: 2, name: "rev-2", appliedAt: "2026-01-01T00:00:00.000Z" },
    });
    const registry: MigrationModule<unknown>[] = [
      { module: "m", context: () => ({}), migrations: [rev(1), rev(2), rev(3)] },
    ];

    const report = await applyMigrations({ registry, ledger });

    expect(order).toEqual(["m:3"]);
    expect(report.applied.map((a) => a.id)).toEqual([3]);
  });

  it("does nothing when the ledger is already current", async () => {
    const { order, rev } = recorder();
    const ledger = memoryLedger({
      m: { id: 2, name: "rev-2", appliedAt: "2026-01-01T00:00:00.000Z" },
    });

    const report = await applyMigrations({
      registry: [{ module: "m", context: () => ({}), migrations: [rev(1), rev(2)] }],
      ledger,
    });

    expect(order).toEqual([]);
    expect(report.applied).toEqual([]);
  });

  it("does not resolve the context when nothing is pending", async () => {
    let resolved = 0;
    const ledger = memoryLedger({
      m: { id: 1, name: "rev-1", appliedAt: "2026-01-01T00:00:00.000Z" },
    });

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => {
            resolved += 1;
            return {};
          },
          migrations: [{ id: 1, name: "rev-1", up: () => undefined }],
        },
      ],
      ledger,
    });

    expect(resolved).toBe(0);
  });

  it("resolves the context exactly once for a module with pending revisions", async () => {
    let resolved = 0;
    const { rev } = recorder();

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => {
            resolved += 1;
            return {};
          },
          migrations: [rev(1), rev(2)],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(resolved).toBe(1);
  });

  it("passes the resolved context to every revision", async () => {
    const context = { handle: "storage" };
    const seen: unknown[] = [];

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => context,
          migrations: [
            { id: 1, name: "a", up: (ctx) => void seen.push(ctx) },
            { id: 2, name: "b", up: (ctx) => void seen.push(ctx) },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(seen).toEqual([context, context]);
  });

  it("awaits an async context factory and an async `up`", async () => {
    const order: string[] = [];

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: async () => {
            order.push("context");
            return {};
          },
          migrations: [
            {
              id: 1,
              name: "a",
              up: async () => {
                order.push("up");
              },
            },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(order).toEqual(["context", "up"]);
  });

  it("writes the ledger after each revision, not once at the end", async () => {
    const { ledger, writes } = tracingLedger(memoryLedger());
    const seenDuringRun: number[] = [];

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            { id: 1, name: "a", up: () => void seenDuringRun.push(writes.length) },
            { id: 2, name: "b", up: () => void seenDuringRun.push(writes.length) },
            { id: 3, name: "c", up: () => void seenDuringRun.push(writes.length) },
          ],
        },
      ],
      ledger,
    });

    // Revision N sees exactly N-1 completed writes: each is recorded before the
    // next begins, which is what makes a killed run resumable.
    expect(seenDuringRun).toEqual([0, 1, 2]);
    expect(writes.map((w) => w.revision.id)).toEqual([1, 2, 3]);
  });

  it("records the revision name and an ISO-8601 timestamp in the ledger", async () => {
    const ledger = memoryLedger();

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [{ id: 4, name: "split-scheme", up: () => undefined }],
        },
      ],
      ledger,
    });

    const entry = (await ledger.read())["m"];
    expect(entry?.id).toBe(4);
    expect(entry?.name).toBe("split-scheme");
    expect(entry?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("runs modules sequentially in registration order", async () => {
    const { order, rev } = recorder();

    await applyMigrations({
      registry: [
        { module: "a", context: () => ({}), migrations: [rev(1, "a"), rev(2, "a")] },
        { module: "b", context: () => ({}), migrations: [rev(1, "b")] },
      ],
      ledger: memoryLedger(),
    });

    expect(order).toEqual(["a:1", "a:2", "b:1"]);
  });

  it("tracks each module's revision independently", async () => {
    const ledger = memoryLedger({
      a: { id: 1, name: "rev-1", appliedAt: "2026-01-01T00:00:00.000Z" },
    });
    const { order, rev } = recorder();

    await applyMigrations({
      registry: [
        { module: "a", context: () => ({}), migrations: [rev(1, "a"), rev(2, "a")] },
        { module: "b", context: () => ({}), migrations: [rev(1, "b")] },
      ],
      ledger,
    });

    expect(order).toEqual(["a:2", "b:1"]);
  });

  it("gives each revision its identity in utils", async () => {
    const seen: unknown[] = [];

    await applyMigrations({
      registry: [
        {
          module: "@scope/pkg",
          context: () => ({}),
          migrations: [
            { id: 7, name: "seven", up: (_ctx, utils) => void seen.push(utils.revision) },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(seen).toEqual([{ module: "@scope/pkg", id: 7, name: "seven" }]);
  });
});

describe("applyMigrations — failures", () => {
  it("rejects with MigrationFailedError carrying the report", async () => {
    const boom = new Error("boom");
    const promise = applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            {
              id: 1,
              name: "explodes",
              up: () => {
                throw boom;
              },
            },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.failed).toEqual([{ module: "m", id: 1, name: "explodes", error: boom }]);
    });
  });

  it("halts the failing module at the failing revision", async () => {
    const order: string[] = [];
    const promise = applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            { id: 1, name: "a", up: () => void order.push("a") },
            {
              id: 2,
              name: "b",
              up: () => {
                throw new Error("boom");
              },
            },
            { id: 3, name: "c", up: () => void order.push("c") },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toThrow();
    expect(order).toEqual(["a"]);
  });

  it("leaves the ledger at the last successful revision", async () => {
    const ledger = memoryLedger();
    const promise = applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            { id: 1, name: "a", up: () => undefined },
            {
              id: 2,
              name: "b",
              up: () => {
                throw new Error("boom");
              },
            },
          ],
        },
      ],
      ledger,
    });

    await expect(promise).rejects.toThrow();
    expect((await ledger.read())["m"]?.id).toBe(1);
  });

  it("still runs later modules after one fails", async () => {
    const order: string[] = [];
    const promise = applyMigrations({
      registry: [
        {
          module: "a",
          context: () => ({}),
          migrations: [
            {
              id: 1,
              name: "boom",
              up: () => {
                throw new Error("boom");
              },
            },
          ],
        },
        {
          module: "b",
          context: () => ({}),
          migrations: [{ id: 1, name: "ok", up: () => void order.push("b:1") }],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toThrow();
    expect(order).toEqual(["b:1"]);
  });

  it("reports an applied revision alongside a failure", async () => {
    const promise = applyMigrations({
      registry: [
        {
          module: "a",
          context: () => ({}),
          migrations: [
            {
              id: 1,
              name: "boom",
              up: () => {
                throw new Error("boom");
              },
            },
          ],
        },
        {
          module: "b",
          context: () => ({}),
          migrations: [{ id: 1, name: "ok", up: () => undefined }],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.applied).toEqual([{ module: "b", id: 1, name: "ok" }]);
      expect(error.report.failed).toHaveLength(1);
    });
  });

  it("records an invalid manifest as a module-level failure without a revision", async () => {
    const promise = applyMigrations({
      registry: [
        { module: "a", context: () => ({}), migrations: [rev(2), rev(1)] },
        { module: "b", context: () => ({}), migrations: [rev(1)] },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.failed).toHaveLength(1);
      expect(error.report.failed[0]?.module).toBe("a");
      expect(error.report.failed[0]?.id).toBeUndefined();
      expect(error.report.applied.map((a) => a.module)).toEqual(["b"]);
    });
  });

  it("records a duplicate module registration as a failure", async () => {
    const promise = applyMigrations({
      registry: [
        { module: "a", context: () => ({}), migrations: [rev(1)] },
        { module: "a", context: () => ({}), migrations: [rev(1)] },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.failed).toHaveLength(1);
      expect(error.report.failed[0]?.error.message).toMatch(/registered more than once/);
    });
  });

  it("records a throwing context factory as a module-level failure", async () => {
    const promise = applyMigrations({
      registry: [
        {
          module: "a",
          context: () => {
            throw new Error("cannot open storage");
          },
          migrations: [rev(1)],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.failed[0]?.id).toBeUndefined();
      expect(error.report.failed[0]?.error.message).toBe("cannot open storage");
    });
  });
});

describe("applyMigrations — ledger ahead of code", () => {
  it("reports a downgrade without throwing", async () => {
    const ledger = memoryLedger({
      m: { id: 5, name: "rev-5", appliedAt: "2026-01-01T00:00:00.000Z" },
    });
    const { order, rev: makeRev } = recorder();

    const report = await applyMigrations({
      registry: [{ module: "m", context: () => ({}), migrations: [makeRev(1), makeRev(2)] }],
      ledger,
    });

    expect(report.ahead).toEqual([{ module: "m", ledgerRevision: 5, latestKnown: 2 }]);
    expect(report.failed).toEqual([]);
    expect(order).toEqual([]);
  });

  it("warns through the logger when one is supplied", async () => {
    const warnings: string[] = [];
    const ledger = memoryLedger({
      m: { id: 5, name: "rev-5", appliedAt: "2026-01-01T00:00:00.000Z" },
    });

    await applyMigrations({
      registry: [{ module: "m", context: () => ({}), migrations: [rev(1)] }],
      ledger,
      log: {
        info: () => undefined,
        warn: (message) => void warnings.push(message),
        error: () => undefined,
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ahead/);
  });
});

describe("applyMigrations — hooks", () => {
  it("fires once per revision with the module and revision only", async () => {
    const hooks = new Hook.Collection<any>();
    const payloads: unknown[] = [];
    hooks.before("migrate", (options: unknown) => {
      payloads.push(JSON.parse(JSON.stringify(options)));
    });

    await applyMigrations({
      registry: [
        {
          module: "@scope/pkg",
          context: () => ({ secret: "storage handle" }),
          migrations: [
            { id: 1, name: "a", up: () => undefined },
            { id: 2, name: "b", up: () => undefined },
          ],
        },
      ],
      ledger: memoryLedger(),
      hooks,
    });

    expect(payloads).toEqual([
      { module: "@scope/pkg", revision: { id: 1, name: "a" } },
      { module: "@scope/pkg", revision: { id: 2, name: "b" } },
    ]);
  });

  it("does not expose the context or the scratch to hooks", async () => {
    const hooks = new Hook.Collection<any>();
    const keys: string[][] = [];
    hooks.before("migrate", (options: Record<string, unknown>) => {
      keys.push(Object.keys(options).sort());
    });

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({ handle: "secret" }),
          migrations: [{ id: 1, name: "a", up: () => undefined }],
        },
      ],
      ledger: memoryLedger(),
      hooks,
    });

    expect(keys).toEqual([["module", "revision"]]);
  });

  it("surfaces a hook error as a revision failure", async () => {
    const hooks = new Hook.Collection<any>();
    hooks.before("migrate", () => {
      throw new Error("hook rejected");
    });

    const promise = applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [{ id: 1, name: "a", up: () => undefined }],
        },
      ],
      ledger: memoryLedger(),
      hooks,
    });

    await expect(promise).rejects.toBeInstanceOf(MigrationFailedError);
    await promise.catch((error: MigrationFailedError) => {
      expect(error.report.failed[0]?.error.message).toBe("hook rejected");
    });
  });
});

describe("applyMigrations — scratch lifecycle", () => {
  it("wipes the scratch after a successful revision", async () => {
    let captured: MigrationUtilsCapture | undefined;

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            {
              id: 1,
              name: "a",
              up: (_ctx, utils) => {
                utils.secrets.put("seed", new Uint8Array([1, 2, 3]));
                captured = utils.secrets;
              },
            },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(() => captured?.has("seed")).toThrow(SecretScratchDisposedError);
  });

  it("wipes the scratch when a revision throws", async () => {
    let captured: MigrationUtilsCapture | undefined;
    const bytes = new Uint8Array([1, 2, 3]);

    const promise = applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            {
              id: 1,
              name: "a",
              up: (_ctx, utils) => {
                utils.secrets.put("seed", bytes);
                captured = utils.secrets;
                throw new Error("boom");
              },
            },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    await expect(promise).rejects.toThrow();
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    expect(() => captured?.has("seed")).toThrow(SecretScratchDisposedError);
  });

  it("gives each revision its own scratch", async () => {
    const scratches: MigrationUtilsCapture[] = [];

    await applyMigrations({
      registry: [
        {
          module: "m",
          context: () => ({}),
          migrations: [
            { id: 1, name: "a", up: (_ctx, utils) => void scratches.push(utils.secrets) },
            { id: 2, name: "b", up: (_ctx, utils) => void scratches.push(utils.secrets) },
          ],
        },
      ],
      ledger: memoryLedger(),
    });

    expect(scratches[0]).not.toBe(scratches[1]);
  });
});

describe("applyMigrations — baselining an adopted module", () => {
  const MODULE = "com.mycompany.wallet/watched-accounts";

  /** A synchronous in-memory {@link KeyValueStore}, like MMKV or localStorage. */
  function syncStore(): KeyValueStore {
    const raw = new Map<string, string>();
    return {
      get: (key) => raw.get(key),
      set: (key, value) => {
        raw.set(key, value);
      },
    };
  }

  /** Revisions that record the ids that actually ran. */
  function numbered(ids: number[], ran: number[]): Migration<unknown>[] {
    return ids.map((id) => ({
      id,
      name: `rev-${id}`,
      up: () => {
        ran.push(id);
      },
    }));
  }

  // These pin down the adoption path documented in the package README: an
  // application that already migrated its data with its own mechanism stamps
  // the ledger before constructing the provider, so the engine resumes rather
  // than re-running revisions against data they were already applied to.
  it("skips revisions at or below a pre-stamped baseline", async () => {
    const ledger = keyValueLedger(syncStore());
    await ledger.write(MODULE, {
      id: 3,
      name: "baseline-from-legacy-migrations",
      appliedAt: "2026-01-01T00:00:00.000Z",
    });

    const ran: number[] = [];
    const report = await applyMigrations({
      registry: [
        { module: MODULE, context: () => ({}), migrations: numbered([1, 2, 3, 4, 5], ran) },
      ],
      ledger,
    });

    expect(ran).toEqual([4, 5]);
    expect(report.applied.map((a) => a.id)).toEqual([4, 5]);
    expect((await ledger.read())[MODULE]?.id).toBe(5);
  });

  it("runs every revision on a fresh install, where no baseline is written", async () => {
    const ledger = keyValueLedger(syncStore());
    const ran: number[] = [];

    await applyMigrations({
      registry: [{ module: MODULE, context: () => ({}), migrations: numbered([1, 2, 3], ran) }],
      ledger,
    });

    expect(ran).toEqual([1, 2, 3]);
  });
});
