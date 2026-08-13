import { describe, it, expect } from "vitest";
import { base64UrlDecode, base64UrlDecodeToString, base64UrlEncode } from "./base64.ts";

describe("base64url", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("round-trips UTF-8 strings", () => {
    const text = "hello — ✓ world";
    expect(base64UrlDecodeToString(base64UrlEncode(text))).toBe(text);
  });

  it("produces unpadded URL-safe output", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("tolerates padded input on decode", () => {
    const encoded = base64UrlEncode("ab");
    expect(base64UrlDecodeToString(`${encoded}==`)).toBe("ab");
  });
});
