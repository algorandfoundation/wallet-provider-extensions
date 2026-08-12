import { createSecretScratch } from "./secrets.ts";
import type { Migration, MigrationUtils } from "./types.ts";

/** Arguments for {@link assertIdempotent}. */
export interface AssertIdempotentOptions<Ctx> {
  /** The revision under test. */
  migration: Migration<Ctx>;
  /** Builds the context. Called once — both runs share it, as in production. */
  context: () => Ctx | Promise<Ctx>;
  /** Captures the observable state after a run, for comparison. */
  snapshot: (context: Ctx) => unknown | Promise<unknown>;
  /** Module id used in `utils.revision`. Defaults to `"assertIdempotent"`. */
  module?: string;
}

/**
 * Asserts that a migration converges: running it twice against the same context
 * must leave identical state.
 *
 * Every revision must satisfy this. The runner records the ledger after each
 * revision, so a re-run only happens when something else went wrong — a failed
 * ledger write, storage cleared underneath the application, a partially applied
 * revision resumed. Those are exactly the cases where a non-idempotent
 * migration corrupts data.
 *
 * Snapshots are compared structurally: object key order is normalised and
 * `Uint8Array` values are compared by content, so a rewrite that only changes
 * insertion order does not read as a difference.
 *
 * @param options - {@link AssertIdempotentOptions}.
 * @throws {Error} When the two runs produce different snapshots.
 * @throws {Error} When `snapshot` returns `undefined` (almost always a missing
 *   `return`) — an undefined snapshot always compares equal to itself, which
 *   would otherwise let a non-idempotent migration pass unnoticed.
 * @throws {Error} When the snapshot contains a `Map` or `Set` — neither
 *   survives structural comparison (both normalise to `{}` regardless of
 *   content); convert to an array or plain object first.
 *
 * @example
 * ```typescript
 * await assertIdempotent({
 *   migration,
 *   context: () => seededStorage(),
 *   snapshot: (storage) => storage.entries(),
 * });
 * ```
 */
export async function assertIdempotent<Ctx>(options: AssertIdempotentOptions<Ctx>): Promise<void> {
  const { migration, snapshot } = options;
  const module = options.module ?? "assertIdempotent";
  const context = await options.context();

  async function runOnce(): Promise<string> {
    const { scratch, wipeAll } = createSecretScratch();
    const utils: MigrationUtils = {
      revision: { module, id: migration.id, name: migration.name },
      secrets: scratch,
    };
    try {
      await migration.up(context, utils);
    } finally {
      wipeAll();
    }
    const captured = await snapshot(context);
    if (captured === undefined) {
      throw new Error(
        `assertIdempotent: \`snapshot\` returned undefined for migration "${migration.name}" ` +
          `(revision ${migration.id}). Did the callback forget its \`return\` statement? ` +
          "`JSON.stringify(undefined)` is also `undefined`, so an undefined snapshot would " +
          "compare equal on every run and let a non-idempotent migration pass unnoticed — " +
          "return the observable state instead (e.g. `(storage) => storage.entries()`).",
      );
    }
    return JSON.stringify(normalise(captured), null, 2);
  }

  const first = await runOnce();
  const second = await runOnce();

  if (first !== second) {
    throw new Error(
      `Migration "${migration.name}" (revision ${migration.id}) is not idempotent.\n` +
        `After the first run:\n${first}\n\nAfter the second run:\n${second}`,
    );
  }
}

/**
 * Recursively normalises a snapshot so comparison is order-insensitive:
 * object keys are sorted and typed arrays become plain number arrays.
 *
 * `Map` and `Set` are rejected outright rather than silently normalised: both
 * would fall through to the plain-object branch, whose `Object.keys()` sees
 * none of their entries, so every `Map`/`Set` — regardless of content —
 * collapses to the same `{}` and a migration that corrupts one on every run
 * would pass `assertIdempotent` vacuously.
 */
function normalise(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (value instanceof Map || value instanceof Set) {
    const kind = value instanceof Map ? "Map" : "Set";
    throw new Error(
      `assertIdempotent: snapshot contains a ${kind}, which \`JSON.stringify\` cannot see the ` +
        `contents of (it normalises to "{}" regardless of what it holds), so a non-idempotent ` +
        `migration could pass unnoticed. Convert it in your \`snapshot\` callback — e.g. ` +
        `\`Array.from(value.entries())\` for a Map, or \`Array.from(value)\` for a Set — or to a ` +
        "plain object.",
    );
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalise(record[key])]),
    );
  }
  return value;
}
