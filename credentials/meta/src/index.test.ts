import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DigitalCredentialsUnsupportedError,
  createCredentialStore,
} from "@algorandfoundation/credentials-core";
import * as node from "@algorandfoundation/credentials-node";
import * as meta from "./index.ts";

// vitest runs with the package directory as cwd.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  exports: Record<string, Record<string, unknown>>;
  dependencies?: Record<string, string>;
};

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

  it("routes node and default to the node entry", () => {
    expect(pkg.exports["."].node).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    });
    expect(pkg.exports["."].default).toBe("./dist/index.js");
    expect(Object.keys(pkg.dependencies ?? {})).toContain("@algorandfoundation/credentials-node");
  });

  it("stays backend-agnostic (no intermezzo dependencies)", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain("@algorandfoundation/credentials-intermezzo-extension");
    expect(deps).not.toContain("@algorandfoundation/intermezzo-client");
  });
});

describe("node entry", () => {
  it("is a pure re-export of @algorandfoundation/credentials-node", () => {
    expect(meta.WithCredentials).toBe(node.WithCredentials);
    expect(meta.nodeDigitalCredentials).toBe(node.nodeDigitalCredentials);
    expect(meta.createCredentialStore).toBe(createCredentialStore);
    expect(meta.DigitalCredentialsUnsupportedError).toBe(DigitalCredentialsUnsupportedError);
  });

  it("re-exports the full credentials-core surface", () => {
    expect(meta.addCredential).toBeTypeOf("function");
    expect(meta.queryCredentials).toBeTypeOf("function");
    expect(meta.parseSdJwtVc).toBeTypeOf("function");
    expect(meta.encodeDidKey).toBeTypeOf("function");
    expect(meta.parseCredentialOfferUrl).toBeTypeOf("function");
    expect(meta.identityHolderBinding).toBeTypeOf("function");
  });

  it("does not export a default", () => {
    expect((meta as Record<string, unknown>).default).toBeUndefined();
  });
});
