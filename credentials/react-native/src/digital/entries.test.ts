import { describe, it, expect } from "vitest";

import { validateEntries } from "./entries.ts";
import type { RegisteredSdJwtCredential } from "./types.ts";

const valid: RegisteredSdJwtCredential = {
  id: "credential-1",
  format: "dc+sd-jwt",
  vct: "https://credentials.example/identity",
  title: "Identity",
  subtitle: "Algorand Wallet",
  claims: [{ path: ["given_name"], value: "Ada", displayName: "Given name" }],
};

describe("validateEntries", () => {
  it("accepts a well-formed entry", () => {
    expect(() => validateEntries([valid])).not.toThrow();
  });

  it("accepts an empty entry list", () => {
    expect(() => validateEntries([])).not.toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => validateEntries([{ ...valid, id: "" }])).toThrow(/id is required/);
  });

  it("rejects an id longer than 64 characters", () => {
    expect(() => validateEntries([{ ...valid, id: "a".repeat(65) }])).toThrow(
      /at most 64 characters/,
    );
  });

  it("rejects a missing vct", () => {
    expect(() => validateEntries([{ ...valid, vct: "" }])).toThrow(/vct is required/);
  });

  it("rejects a missing title", () => {
    expect(() => validateEntries([{ ...valid, title: "" }])).toThrow(/title is required/);
  });

  it("rejects an empty claim path", () => {
    expect(() =>
      validateEntries([{ ...valid, claims: [{ path: [], displayName: "Nothing" }] }]),
    ).toThrow(/claims\[0\]\.path must be a non-empty array/);
  });

  it("reports the offending entry index", () => {
    expect(() => validateEntries([valid, { ...valid, vct: "" }])).toThrow(/entries\[1\]\.vct/);
  });
});
