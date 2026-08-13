import { validateMigrations } from "@algorandfoundation/provider-migrations";
import { describe, expect, it } from "vitest";
import { migrations } from "./index.ts";

describe("migrations manifest", () => {
  it("has valid, ascending revision ids", () => {
    expect(() =>
      validateMigrations(migrations, "@algorandfoundation/react-native-keystore"),
    ).not.toThrow();
  });

  it("declares revisions 1 and 2, in order", () => {
    expect(migrations.map((m) => m.id)).toEqual([1, 2]);
  });
});
