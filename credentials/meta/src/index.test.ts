import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { DigitalCredentialsUnsupportedError } from "@algorandfoundation/credentials-core";
import * as meta from "./index.ts";

// vitest runs with the package directory as cwd.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<
  string,
  any
>;

describe("@algorandfoundation/credentials export map", () => {
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

  it("stays backend-agnostic (no intermezzo dependencies)", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain("@algorandfoundation/credentials-intermezzo-extension");
    expect(deps).not.toContain("@algorandfoundation/intermezzo-client");
  });
});

describe("node entry", () => {
  it("re-exports the full credentials-core surface", () => {
    expect(meta.WithCredentials).toBeTypeOf("function");
    expect(meta.addCredential).toBeTypeOf("function");
    expect(meta.queryCredentials).toBeTypeOf("function");
    expect(meta.parseSdJwtVc).toBeTypeOf("function");
    expect(meta.encodeDidKey).toBeTypeOf("function");
    expect(meta.parseCredentialOfferUrl).toBeTypeOf("function");
    expect(meta.DigitalCredentialsUnsupportedError).toBe(DigitalCredentialsUnsupportedError);
  });

  it("exposes an explicit node unsupported Digital Credentials stub", async () => {
    expect(meta.nodeDigitalCredentials.isSupported()).toBe(false);
    await expect(meta.nodeDigitalCredentials.get({ requests: [] })).rejects.toBeInstanceOf(
      DigitalCredentialsUnsupportedError,
    );
    await expect(meta.nodeDigitalCredentials.create({ requests: [] })).rejects.toBeInstanceOf(
      DigitalCredentialsUnsupportedError,
    );
  });
});
