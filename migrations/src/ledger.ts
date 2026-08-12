import type { KeyValueStore, MigrationLedger, Revision } from "./types.ts";

/** Default storage key under which the whole ledger map is serialised. */
export const DEFAULT_LEDGER_KEY: string = "@algorandfoundation/provider-migrations";

/**
 * An in-memory {@link MigrationLedger}.
 *
 * Nothing survives a restart, so every migration re-runs on the next launch.
 * Intended for tests and deliberately ephemeral use — never as an application's
 * durable ledger.
 *
 * @param initial - Revisions to seed the ledger with.
 * @returns An in-memory {@link MigrationLedger}.
 *
 * @example
 * ```typescript
 * const ledger = memoryLedger({ "@scope/pkg": { id: 1, name: "first", appliedAt: iso } });
 * ```
 */
export function memoryLedger(initial: Record<string, Revision> = {}): MigrationLedger {
  const state: Record<string, Revision> = { ...initial };
  return {
    read(): Promise<Record<string, Revision>> {
      return Promise.resolve({ ...state });
    },
    write(module: string, revision: Revision): Promise<void> {
      state[module] = revision;
      return Promise.resolve();
    },
  };
}

/**
 * A {@link MigrationLedger} backed by any string key/value store.
 *
 * The whole map is serialised as one JSON blob under a single key, so a run
 * resolves the entire graph with one read. An absent, unparseable, or
 * non-object payload reads as empty — which re-runs every migration, and is
 * safe precisely because migrations are required to be idempotent.
 *
 * @param kv - The backing store. MMKV, `localStorage`, AsyncStorage, or a file
 *   wrapper all adapt in two lines.
 * @param options - Optional storage key override.
 * @returns A durable {@link MigrationLedger}.
 *
 * @example
 * ```typescript
 * keyValueLedger({ get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) });
 * ```
 */
export function keyValueLedger(kv: KeyValueStore, options?: { key?: string }): MigrationLedger {
  const key = options?.key ?? DEFAULT_LEDGER_KEY;

  async function load(): Promise<Record<string, Revision>> {
    const raw = await kv.get(key);
    if (!raw) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, Revision>;
    } catch {
      // A corrupt ledger is treated as absent: every migration re-runs, which
      // idempotency makes safe. Throwing here would brick the application.
      return {};
    }
  }

  return {
    read(): Promise<Record<string, Revision>> {
      return load();
    },
    /**
     * Read-modify-write over the single JSON blob: `load()` the whole map,
     * patch this module's entry, then write the whole map back. Safe within a
     * single sequential run (revisions are applied one at a time and this
     * ledger is only ever awaited, never fired concurrently, by
     * `applyMigrations`), but if two provider instances shared one ledger and
     * called `write` concurrently, the later write's `load()` could miss the
     * earlier one's not-yet-persisted change and clobber it on save.
     */
    async write(module: string, revision: Revision): Promise<void> {
      const state = await load();
      state[module] = revision;
      await kv.set(key, JSON.stringify(state));
    },
  };
}
