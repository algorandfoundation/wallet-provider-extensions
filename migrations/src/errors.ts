import type { MigrationReport } from "./types.ts";

/**
 * Base class for every error raised by the migrations engine.
 */
export class MigrationError extends Error {
  /**
   * @param message - The human-readable message.
   * @param name - The concrete error name.
   * @param cause - The underlying error, if any.
   */
  constructor(message: string, name: string, cause?: Error) {
    super(message);
    this.name = name;
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MigrationError);
    }
  }
}

/**
 * Thrown when `WithMigrations` is constructed without `options.migrations.ledger`.
 *
 * Defaulting silently to an in-memory ledger would make every migration re-run
 * on every launch, forever.
 */
export class MissingLedgerError extends MigrationError {
  constructor() {
    super(
      "WithMigrations requires `options.migrations.ledger`. Use `memoryLedger()` for tests or `keyValueLedger(kv)` for durable storage.",
      "MissingLedgerError",
    );
  }
}

/**
 * Thrown when a module's manifest is malformed: non-positive, duplicate, or
 * out-of-order revision ids, or the same module registered twice.
 */
export class InvalidMigrationsError extends MigrationError {
  /**
   * @param module - The offending module id.
   * @param reason - What is wrong with the manifest.
   */
  constructor(module: string, reason: string) {
    super(`Invalid migrations for ${module}: ${reason}`, "InvalidMigrationsError");
  }
}

/** Thrown when a secret scratch is used after the runner has wiped it. */
export class SecretScratchDisposedError extends MigrationError {
  constructor() {
    super(
      "This revision's secret scratch has been wiped and can no longer be used",
      "SecretScratchDisposedError",
    );
  }
}

/** Thrown when reading a label that holds no secret. */
export class SecretNotFoundError extends MigrationError {
  /**
   * @param label - The label that was not found.
   */
  constructor(label: string) {
    super(`No secret stored under label: ${label}`, "SecretNotFoundError");
  }
}

/**
 * Aggregate thrown at the end of a run in which at least one module failed.
 * Carries the full {@link MigrationReport}, including whatever succeeded.
 */
export class MigrationFailedError extends MigrationError {
  /** The full report for the run, including successful revisions. */
  readonly report: MigrationReport;

  /**
   * @param report - The report for the completed run.
   */
  constructor(report: MigrationReport) {
    const summary = report.failed
      .map((failure) =>
        failure.id === undefined
          ? `  ${failure.module}: ${failure.error.message}`
          : `  ${failure.module} rev ${failure.id} "${failure.name}": ${failure.error.message}`,
      )
      .join("\n");
    super(`${report.failed.length} migration module(s) failed\n${summary}`, "MigrationFailedError");
    this.report = report;
  }
}
