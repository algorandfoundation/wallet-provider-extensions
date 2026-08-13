import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { HookCollection } from "before-after-hook";

/**
 * A revision recorded in the ledger: the last migration a module successfully
 * applied.
 */
export interface Revision {
  /** The revision id that was applied. */
  id: number;
  /** The revision's human-readable name. */
  name: string;
  /** ISO-8601 timestamp of when it was applied. */
  appliedAt: string;
}

/**
 * Run-scoped, in-memory custodian for secret material moving between storages.
 *
 * Created fresh for each revision and wiped by the runner once the revision
 * settles, so material never outlives the migration that handled it.
 */
export interface SecretScratch {
  /**
   * Takes ownership of `bytes`. The caller must not touch the array afterwards.
   * Deliberately does not copy — a copy would mean a second plaintext buffer
   * alive in the heap.
   */
  put(label: string, bytes: Uint8Array): void;
  /** Lends the stored bytes to `fn` for the duration of the call only. */
  use<T>(label: string, fn: (bytes: Uint8Array) => T | Promise<T>): Promise<T>;
  /** Whether a secret is stored under `label`. */
  has(label: string): boolean;
  /** Zeroes and drops one entry. A no-op for an unknown label. */
  wipe(label: string): void;
  /** Redacts the scratch so material cannot leak through `JSON.stringify`. */
  toJSON(): string;
}

/**
 * The subset of the log extension's API the engine uses. Declared structurally
 * so this package takes no dependency on `@algorandfoundation/log-store`.
 */
export interface MigrationLogger {
  info(message: string, metadata?: Record<string, unknown>, context?: string): void;
  warn(message: string, metadata?: Record<string, unknown>, context?: string): void;
  error(message: string, metadata?: Record<string, unknown>, context?: string): void;
}

/** Second argument handed to every {@link Migration.up}. */
export interface MigrationUtils {
  /** Identity of the revision currently running. */
  readonly revision: Readonly<{ module: string; id: number; name: string }>;
  /** Secure scratch, wiped once this revision settles. */
  readonly secrets: SecretScratch;
  /** Present only when the provider carries a log extension. */
  readonly log?: MigrationLogger;
}

/**
 * A single forward-only data migration.
 *
 * `up` must be **idempotent** — running it twice must converge to the same
 * state — and must be a no-op when there is nothing to migrate.
 *
 * @example
 * ```typescript
 * export const migration: Migration<MyStorage> = {
 *   id: 1,
 *   name: "add-scheme-field",
 *   up: (storage) => {
 *     for (const record of readAll(storage)) {
 *       if (record.scheme) continue; // already migrated
 *       write(storage, { ...record, scheme: "v2" });
 *     }
 *   },
 * };
 * ```
 */
export interface Migration<Ctx = unknown> {
  /** Positive integer. Unique and strictly ascending within a module. */
  id: number;
  /** Human-readable name, used in logs and the report. */
  name: string;
  up(context: Ctx, utils: MigrationUtils): Promise<void> | void;
}

/** A module's registration: its identity, its context, and its revisions. */
export interface MigrationModule<Ctx = unknown> {
  /** Unique module id. Use the package name. */
  module: string;
  /** Resolved lazily — only called when the module has pending revisions. */
  context: () => Ctx | Promise<Ctx>;
  /** The module's revisions, ascending by id. */
  migrations: readonly Migration<Ctx>[];
}

/** Durable record of which revision each module has reached. */
export interface MigrationLedger {
  /** Reads the whole map. An absent or unreadable ledger reads as `{}`. */
  read(): Promise<Record<string, Revision>>;
  /** Records `revision` as the latest applied for `module`. */
  write(module: string, revision: Revision): Promise<void>;
}

/** A revision that was applied during a run. */
export interface AppliedRevision {
  module: string;
  id: number;
  name: string;
}

/** A failure recorded during a run. */
export interface FailedRevision {
  module: string;
  /** Absent when the failure is module-level (invalid manifest, context error). */
  id?: number;
  /** Absent when the failure is module-level. */
  name?: string;
  error: Error;
}

/** A module whose ledger revision exceeds the highest revision it declares. */
export interface AheadModule {
  module: string;
  ledgerRevision: number;
  latestKnown: number;
}

/** The outcome of a migration run. */
export interface MigrationReport {
  applied: AppliedRevision[];
  failed: FailedRevision[];
  ahead: AheadModule[];
}

/** The API `WithMigrations` places on the provider as `provider.migrations`. */
export interface MigrationsApi {
  /** Registers a module. Called by opted-in extensions during construction. */
  register<Ctx>(module: MigrationModule<Ctx>): void;
  /** Promise of the first run. Rejects with `MigrationFailedError` on failure. */
  readonly ready: Promise<MigrationReport>;
  /** Starts the run if it has not started; returns the same promise as `ready`. */
  run(): Promise<MigrationReport>;
  /** Fires `"migrate"` once per revision, with `{ module, revision }`. */
  readonly hooks: HookCollection<any>;
}

/** The shape `WithMigrations` contributes to the provider. */
export interface MigrationsExtension {
  migrations: MigrationsApi;
}

/** Provider options consumed by {@link MigrationsExtension}. */
export interface MigrationsOptions extends ExtensionOptions {
  migrations: {
    /** Required. Where revisions are recorded. */
    ledger: MigrationLedger;
    /** Defaults to `true`. When `false`, nothing runs until `run()` is called. */
    autoRun?: boolean;
    /** Optional pre-built hook collection. */
    hooks?: HookCollection<any>;
  };
}

/**
 * Minimal synchronous or asynchronous string key/value store, adapted by
 * {@link MigrationLedger} implementations. Deliberately matches neither MMKV
 * nor `localStorage` — a two-line lambda adapts either.
 */
export interface KeyValueStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): void | Promise<void>;
}

/** Arguments for the pure runner. */
export interface ApplyMigrationsOptions {
  /** Registered modules, in registration order. */
  registry: readonly MigrationModule<any>[];
  ledger: MigrationLedger;
  hooks?: HookCollection<any>;
  log?: MigrationLogger;
}
