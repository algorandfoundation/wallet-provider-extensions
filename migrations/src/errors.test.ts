import { describe, expect, it } from "vitest";
import {
  InvalidMigrationsError,
  MigrationError,
  MigrationFailedError,
  MissingLedgerError,
  SecretNotFoundError,
  SecretScratchDisposedError,
} from "./errors.ts";
import type { MigrationReport } from "./types.ts";

describe("errors", () => {
  it("sets a distinct name on every error", () => {
    expect(new MissingLedgerError().name).toBe("MissingLedgerError");
    expect(new InvalidMigrationsError("m", "why").name).toBe("InvalidMigrationsError");
    expect(new SecretScratchDisposedError().name).toBe("SecretScratchDisposedError");
    expect(new SecretNotFoundError("label").name).toBe("SecretNotFoundError");
  });

  it("derives every error from MigrationError", () => {
    expect(new MissingLedgerError()).toBeInstanceOf(MigrationError);
    expect(new SecretNotFoundError("x")).toBeInstanceOf(Error);
  });

  it("names the module and the reason in an invalid-migrations message", () => {
    const error = new InvalidMigrationsError("@scope/pkg", "duplicate revision id 2");
    expect(error.message).toContain("@scope/pkg");
    expect(error.message).toContain("duplicate revision id 2");
  });

  it("names the missing label in a secret-not-found message", () => {
    expect(new SecretNotFoundError("seed").message).toContain("seed");
  });

  it("carries the report and summarises each failure", () => {
    const report: MigrationReport = {
      applied: [],
      failed: [
        { module: "@scope/a", id: 3, name: "split-scheme", error: new Error("boom") },
        { module: "@scope/b", error: new Error("bad manifest") },
      ],
      ahead: [],
    };
    const error = new MigrationFailedError(report);

    expect(error.report).toBe(report);
    expect(error.message).toContain("@scope/a");
    expect(error.message).toContain("3");
    expect(error.message).toContain("split-scheme");
    expect(error.message).toContain("boom");
    expect(error.message).toContain("@scope/b");
    expect(error.message).toContain("bad manifest");
  });
});
