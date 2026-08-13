import { InvalidMigrationsError, MigrationFailedError } from "./errors.ts";
import { createSecretScratch } from "./secrets.ts";
import type {
  ApplyMigrationsOptions,
  Migration,
  MigrationReport,
  MigrationUtils,
} from "./types.ts";

/** Log context tag used for every line the engine emits. */
const LOG_CONTEXT = "@algorandfoundation/provider-migrations";

/**
 * Validates a module's manifest: every revision id must be a positive integer,
 * unique, and strictly ascending.
 *
 * Exported so an adopting package can assert its own barrel in a unit test,
 * catching a duplicate id from a bad merge in CI rather than on a device. The
 * runner calls it for every module before executing anything.
 *
 * @param migrations - The module's revisions, in declaration order.
 * @param module - The module id, used in the error message.
 * @throws {InvalidMigrationsError} When the manifest is malformed.
 *
 * @example
 * ```typescript
 * it("has a valid manifest", () => {
 *   expect(() => validateMigrations(migrations, "@scope/pkg")).not.toThrow();
 * });
 * ```
 */
export function validateMigrations(
  migrations: readonly Migration<any>[],
  module: string = "migrations",
): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id < 1) {
      throw new InvalidMigrationsError(
        module,
        `revision id must be a positive integer, got ${migration.id}`,
      );
    }
    if (migration.id === previous) {
      throw new InvalidMigrationsError(module, `duplicate revision id ${migration.id}`);
    }
    if (migration.id < previous) {
      throw new InvalidMigrationsError(
        module,
        `revision id ${migration.id} is out of order (follows ${previous})`,
      );
    }
    previous = migration.id;
  }
}

/**
 * Applies every pending revision across the registry.
 *
 * Modules run sequentially in registration order. For each module the ledger is
 * consulted, the manifest validated, and the context resolved **only** when
 * something is pending. Each revision runs with a fresh secret scratch that is
 * wiped once it settles, and the ledger is written immediately after each
 * success — never once at the end — so a killed run resumes exactly where it
 * stopped.
 *
 * A failing revision halts only its own module; the ledger keeps that module's
 * last successful revision and remaining modules still run. If anything failed,
 * the returned promise rejects with a {@link MigrationFailedError} carrying the
 * full report.
 *
 * @param options - {@link ApplyMigrationsOptions}.
 * @returns The {@link MigrationReport} for a fully successful run.
 * @throws {MigrationFailedError} When any module failed.
 *
 * @example
 * ```typescript
 * const report = await applyMigrations({ registry, ledger: memoryLedger() });
 * console.log(`${report.applied.length} revisions applied`);
 * ```
 */
export async function applyMigrations(options: ApplyMigrationsOptions): Promise<MigrationReport> {
  const { registry, ledger, hooks, log } = options;
  const report: MigrationReport = { applied: [], failed: [], ahead: [] };
  const state = await ledger.read();
  const seen = new Set<string>();

  for (const entry of registry) {
    const moduleId = entry.module;

    if (seen.has(moduleId)) {
      report.failed.push({
        module: moduleId,
        error: new InvalidMigrationsError(moduleId, "module registered more than once"),
      });
      continue;
    }
    seen.add(moduleId);

    try {
      validateMigrations(entry.migrations, moduleId);
    } catch (error) {
      report.failed.push({ module: moduleId, error: error as Error });
      continue;
    }

    const current = state[moduleId]?.id ?? 0;
    const latestKnown = entry.migrations.reduce(
      (highest: number, migration: Migration<any>) =>
        migration.id > highest ? migration.id : highest,
      0,
    );

    if (current > latestKnown) {
      report.ahead.push({ module: moduleId, ledgerRevision: current, latestKnown });
      log?.warn(
        `Ledger revision ${current} is ahead of the highest known revision ${latestKnown}; skipping`,
        { module: moduleId },
        LOG_CONTEXT,
      );
      continue;
    }

    const pending = entry.migrations.filter((migration) => migration.id > current);
    if (pending.length === 0) {
      continue;
    }

    let context: unknown;
    try {
      context = await entry.context();
    } catch (error) {
      report.failed.push({ module: moduleId, error: error as Error });
      continue;
    }

    for (const migration of pending) {
      const { scratch, wipeAll } = createSecretScratch();
      const utils: MigrationUtils = {
        revision: { module: moduleId, id: migration.id, name: migration.name },
        secrets: scratch,
        log,
      };

      try {
        const invoke = async (): Promise<void> => {
          await migration.up(context, utils);
        };
        if (hooks) {
          await hooks("migrate", invoke, {
            module: moduleId,
            revision: { id: migration.id, name: migration.name },
          });
        } else {
          await invoke();
        }

        await ledger.write(moduleId, {
          id: migration.id,
          name: migration.name,
          appliedAt: new Date().toISOString(),
        });
        report.applied.push({ module: moduleId, id: migration.id, name: migration.name });
        log?.info(
          `Applied revision ${migration.id} (${migration.name})`,
          { module: moduleId },
          LOG_CONTEXT,
        );
      } catch (error) {
        report.failed.push({
          module: moduleId,
          id: migration.id,
          name: migration.name,
          error: error as Error,
        });
        log?.error(
          `Revision ${migration.id} (${migration.name}) failed`,
          { module: moduleId },
          LOG_CONTEXT,
        );
        break;
      } finally {
        wipeAll();
      }
    }
  }

  if (report.failed.length > 0) {
    throw new MigrationFailedError(report);
  }
  return report;
}
