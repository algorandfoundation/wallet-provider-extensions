import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import * as meta from "./index.ts";

// vitest runs with the package directory as cwd.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<
  string,
  any
>;

describe("@algorandfoundation/accounts export map", () => {
  it("routes react-native to the native entry", () => {
    expect(pkg.exports["."]["react-native"]).toEqual({
      types: "./dist/index.native.d.ts",
      default: "./dist/index.native.js",
    });
  });

  it("routes browser to the web entry", () => {
    expect(pkg.exports["."].browser).toEqual({
      types: "./dist/index.web.d.ts",
      default: "./dist/index.web.js",
    });
  });

  it("routes node and default to the platform-neutral entry", () => {
    expect(pkg.exports["."].node).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    });
    expect(pkg.exports["."].default).toBe("./dist/index.js");
  });
});

describe("node entry", () => {
  it("re-exports the WithAccounts extension", () => {
    expect(meta.WithAccounts).toBeTypeOf("function");
  });

  it("re-exports the account store mutations", () => {
    expect(meta.addAccount).toBeTypeOf("function");
    expect(meta.removeAccount).toBeTypeOf("function");
    expect(meta.getAccount).toBeTypeOf("function");
    expect(meta.setActiveAccount).toBeTypeOf("function");
  });
});
