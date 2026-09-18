import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { WithIdentities as WithIdentitiesCore } from "@algorandfoundation/identities-core";
import * as meta from "./index.ts";
import { WithIdentities as WithIdentitiesComposed } from "./extension.ts";

// vitest runs with the package directory as cwd.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<
  string,
  any
>;

describe("@algorandfoundation/identities export map", () => {
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
  it("re-exports the identities store surface", () => {
    expect(meta.addIdentity).toBeTypeOf("function");
    expect(meta.removeIdentity).toBeTypeOf("function");
    expect(meta.getIdentity).toBeTypeOf("function");
    expect(meta.updateIdentityMetadata).toBeTypeOf("function");
    expect(meta.generateDidDocument).toBeTypeOf("function");
  });

  it("exports the composed WithIdentities, shadowing the store-only core one", () => {
    expect(meta.WithIdentities).toBeTypeOf("function");
    expect(meta.WithIdentities).toBe(WithIdentitiesComposed);
    expect(meta.WithIdentities).not.toBe(WithIdentitiesCore);
  });

  it("has no default export", () => {
    expect("default" in meta).toBe(false);
  });
});
