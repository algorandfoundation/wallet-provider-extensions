import { describe, expect, it } from "vitest";

import { normalizeCredentialId, reconcilePasskeys } from "./reconcile.ts";
import type { Passkey } from "./types.ts";

describe("normalizeCredentialId", () => {
  it("passes unpadded base64url strings through", () => {
    expect(normalizeCredentialId("abc-_123")).toBe("abc-_123");
  });

  it("strips base64 padding", () => {
    expect(normalizeCredentialId("YWJj==")).toBe("YWJj");
  });

  it("tolerates the standard base64 alphabet", () => {
    expect(normalizeCredentialId("a+b/c=")).toBe("a-b_c");
  });

  it("encodes Uint8Array ids as unpadded base64url", () => {
    // [251, 239] → "++8=" in standard base64 → "--8" base64url unpadded.
    expect(normalizeCredentialId(new Uint8Array([251, 239]))).toBe("--8");
    expect(normalizeCredentialId(new Uint8Array([97, 98, 99]))).toBe("YWJj");
    expect(normalizeCredentialId(new Uint8Array([97]))).toBe("YQ");
  });

  it("encodes ArrayBuffer ids like their Uint8Array view", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(normalizeCredentialId(bytes.buffer)).toBe(normalizeCredentialId(bytes));
  });
});

describe("reconcilePasskeys", () => {
  const passkey = (overrides: Partial<Passkey> & { credentialId: string }): Passkey => ({
    ...overrides,
  });

  it("marks in-scope listed passkeys known and unlisted ones unknown", () => {
    const local = [
      passkey({ credentialId: "cred-a", rpId: "example.com" }),
      passkey({ credentialId: "cred-b", rpId: "example.com" }),
    ];
    const result = reconcilePasskeys(
      local,
      { rpId: "example.com", allowCredentials: [{ id: "cred-a" }] },
      1234,
    );

    expect(result.known).toEqual([
      { credentialId: "cred-a", rpId: "example.com", serverStatus: "known", reconciledAt: 1234 },
    ]);
    expect(result.strays).toEqual([
      { credentialId: "cred-b", rpId: "example.com", serverStatus: "unknown", reconciledAt: 1234 },
    ]);
    expect(result.missing).toEqual([]);
    expect(result.passkeys).toEqual([...result.known, ...result.strays]);
  });

  it("returns allowCredentials ids with no local match in missing", () => {
    const result = reconcilePasskeys(
      [passkey({ credentialId: "cred-a", rpId: "example.com" })],
      { rpId: "example.com", allowCredentials: [{ id: "cred-a" }, { id: "cred-gone" }] },
      1,
    );

    expect(result.missing).toEqual(["cred-gone"]);
  });

  it("scopes by rpId, matching the host of origin too", () => {
    const local = [
      passkey({ credentialId: "by-rp", rpId: "example.com" }),
      passkey({ credentialId: "by-origin", origin: "https://example.com" }),
      passkey({ credentialId: "elsewhere", rpId: "other.com" }),
    ];
    const result = reconcilePasskeys(local, { rpId: "example.com", allowCredentials: [] }, 7);

    expect(result.strays.map((p) => p.credentialId)).toEqual(["by-rp", "by-origin"]);
    // Out-of-scope passkeys pass through untouched.
    expect(result.passkeys[2]).toEqual(passkey({ credentialId: "elsewhere", rpId: "other.com" }));
  });

  it("treats every passkey as in scope when options carry no rpId", () => {
    const local = [
      passkey({ credentialId: "a", rpId: "one.com" }),
      passkey({ credentialId: "b", rpId: "two.com" }),
    ];
    const result = reconcilePasskeys(local, { allowCredentials: [{ id: "a" }] }, 7);

    expect(result.known.map((p) => p.credentialId)).toEqual(["a"]);
    expect(result.strays.map((p) => p.credentialId)).toEqual(["b"]);
  });

  it("marks all in-scope passkeys unknown when allowCredentials is absent", () => {
    const result = reconcilePasskeys(
      [passkey({ credentialId: "a", rpId: "example.com" })],
      { rpId: "example.com" },
      7,
    );

    expect(result.strays.map((p) => p.credentialId)).toEqual(["a"]);
    expect(result.known).toEqual([]);
  });

  it("normalizes both sides before comparing (padding, alphabet, bytes)", () => {
    const local = [
      passkey({ credentialId: "a+b/c=", rpId: "example.com" }),
      passkey({ credentialId: "YWJj", rpId: "example.com" }),
    ];
    const result = reconcilePasskeys(
      local,
      {
        rpId: "example.com",
        allowCredentials: [{ id: "a-b_c" }, { id: new Uint8Array([97, 98, 99]) }],
      },
      7,
    );

    expect(result.known.map((p) => p.credentialId)).toEqual(["a+b/c=", "YWJj"]);
    expect(result.missing).toEqual([]);
  });

  it("defaults reconciledAt to now", () => {
    const before = Date.now();
    const result = reconcilePasskeys([passkey({ credentialId: "a" })], { allowCredentials: [] });
    expect(result.passkeys[0].reconciledAt).toBeGreaterThanOrEqual(before);
  });
});
