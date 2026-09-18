import { describe, expect, it } from "vitest";

import { LiquidAuthError } from "./errors.ts";
import { buildLiquidUri, parseLiquidUri } from "./uri.ts";

describe("liquid:// URI", () => {
  it("builds the deep link from an https origin", () => {
    expect(buildLiquidUri("https://liquid.example.com", "0192-abc")).toBe(
      "liquid://liquid.example.com/?requestId=0192-abc",
    );
  });

  it("round-trips build → parse", () => {
    const uri = buildLiquidUri("https://liquid.example.com", "0192-abc");
    expect(parseLiquidUri(uri)).toEqual({
      origin: "https://liquid.example.com",
      requestId: "0192-abc",
    });
  });

  it("keeps non-default ports through the round-trip", () => {
    const uri = buildLiquidUri("https://localhost:5000", "req-1");
    expect(uri).toBe("liquid://localhost:5000/?requestId=req-1");
    expect(parseLiquidUri(uri)).toEqual({
      origin: "https://localhost:5000",
      requestId: "req-1",
    });
  });

  it("url-encodes the request id", () => {
    const uri = buildLiquidUri("https://liquid.example.com", "a b&c");
    expect(uri).toContain("requestId=a%20b%26c");
    expect(parseLiquidUri(uri).requestId).toBe("a b&c");
  });

  it.each([
    ["wrong scheme", "https://liquid.example.com/?requestId=x"],
    ["missing requestId", "liquid://liquid.example.com/"],
    ["empty", ""],
    ["scheme only", "liquid://"],
  ])("rejects malformed URIs (%s) with a typed error", (_label, uri) => {
    try {
      parseLiquidUri(uri);
      expect.unreachable("parse must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LiquidAuthError);
      expect((e as LiquidAuthError).code).toBe("invalid_uri");
    }
  });

  it("rejects empty build inputs with a typed error", () => {
    expect(() => buildLiquidUri("", "req")).toThrowError(LiquidAuthError);
    expect(() => buildLiquidUri("https://liquid.example.com", "")).toThrowError(LiquidAuthError);
  });
});
