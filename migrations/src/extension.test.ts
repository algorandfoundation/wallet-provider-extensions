import { Provider } from "@algorandfoundation/wallet-provider";
import type { Extension } from "@algorandfoundation/wallet-provider";
import { describe, expect, it, vi } from "vitest";
import { MigrationFailedError, MissingLedgerError } from "./errors.ts";
import { WithMigrations } from "./extension.ts";
import { memoryLedger } from "./ledger.ts";
import type { MigrationReport, MigrationsApi } from "./types.ts";

/** Builds an extension that registers `ids` as revisions for `module`. */
function registering(module: string, ids: number[], order: string[]): Extension<object> {
  return (provider: any) => {
    provider.migrations?.register({
      module,
      context: () => ({}),
      migrations: ids.map((id) => ({
        id,
        name: `rev-${id}`,
        up: () => {
          order.push(`${module}:${id}`);
        },
      })),
    });
    return {};
  };
}

describe("WithMigrations", () => {
  it("throws MissingLedgerError when no ledger is configured", () => {
    const P = Provider.withExtensions([WithMigrations]);
    expect(() => new P({ id: "p", name: "P" }, {})).toThrow(MissingLedgerError);
  });

  it("exposes the registry to later extensions", () => {
    const order: string[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    expect(provider.migrations).toBeDefined();
    expect(typeof provider.migrations.register).toBe("function");
  });

  it("runs every registered module after the constructor completes", async () => {
    const order: string[] = [];
    const P = Provider.withExtensions([
      WithMigrations,
      registering("a", [1, 2], order),
      registering("b", [1], order),
    ]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    // Nothing has run yet: the microtask cannot fire until the synchronous
    // constructor loop is done.
    expect(order).toEqual([]);

    const report: MigrationReport = await provider.migrations.ready;

    expect(order).toEqual(["a:1", "a:2", "b:1"]);
    expect(report.applied).toHaveLength(3);
  });

  it("persists revisions to the supplied ledger", async () => {
    const ledger = memoryLedger();
    const order: string[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1, 2], order)]);
    const provider = new P({ id: "p", name: "P" }, { migrations: { ledger } }) as any;

    await provider.migrations.ready;

    expect((await ledger.read())["a"]?.id).toBe(2);
  });

  it("does not run until run() is called when autoRun is false", async () => {
    const order: string[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger(), autoRun: false } },
    ) as any;

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    await provider.migrations.run();
    expect(order).toEqual(["a:1"]);
  });

  it("returns the same promise from run() and ready, and runs only once", async () => {
    const order: string[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger(), autoRun: false } },
    ) as any;

    const api = provider.migrations as MigrationsApi;
    const first = api.run();
    const second = api.run();

    expect(first).toBe(second);
    expect(first).toBe(api.ready);
    await first;
    expect(order).toEqual(["a:1"]);
  });

  it("rejects `ready` with MigrationFailedError when a revision throws", async () => {
    const P = Provider.withExtensions([
      WithMigrations,
      (provider: any) => {
        provider.migrations?.register({
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
        });
        return {};
      },
    ]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    await expect(provider.migrations.ready).rejects.toBeInstanceOf(MigrationFailedError);
  });

  it("does not raise an unhandled rejection when `ready` is never awaited", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const P = Provider.withExtensions([
      WithMigrations,
      (provider: any) => {
        provider.migrations?.register({
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
        });
        return {};
      },
    ]);
    new P({ id: "p", name: "P" }, { migrations: { ledger: memoryLedger() } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });

  it("uses a log extension applied AFTER it", async () => {
    const info = vi.fn();
    const order: string[] = [];
    const withLog: Extension<{ log: unknown }> = () => ({
      log: { info, warn: vi.fn(), error: vi.fn() },
    });
    const P = Provider.withExtensions([WithMigrations, withLog, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    await provider.migrations.ready;

    expect(info).toHaveBeenCalled();
  });

  it("tolerates a provider with no log extension", async () => {
    const order: string[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    await expect(provider.migrations.ready).resolves.toBeDefined();
  });

  it("exposes a hook collection that fires per revision", async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    const P = Provider.withExtensions([WithMigrations, registering("a", [1], order)]);
    const provider = new P(
      { id: "p", name: "P" },
      { migrations: { ledger: memoryLedger() } },
    ) as any;

    provider.migrations.hooks.before("migrate", (options: unknown) => {
      seen.push(options);
    });

    await provider.migrations.ready;
    expect(seen).toHaveLength(1);
  });

  it("makes register a no-op when WithMigrations is absent", () => {
    const order: string[] = [];
    const P = Provider.withExtensions([registering("a", [1], order)]);
    const provider = new P({ id: "p", name: "P" }, {}) as any;

    expect(provider.migrations).toBeUndefined();
    expect(order).toEqual([]);
  });
});
