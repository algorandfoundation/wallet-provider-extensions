import { describe, expect, it, vi } from "vitest";

import { fetchAssertionOptions } from "./assertionOptions.ts";
import { LiquidAuthError } from "./errors.ts";

const SIGNAL_URL = "https://liquid.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchAssertionOptions", () => {
  it("POSTs the liquid-client assertion request and normalizes the options", async () => {
    const body = {
      challenge: "Y2hhbGxlbmdl",
      rpId: "example.com",
      allowCredentials: [
        { id: "cred-a", type: "public-key", transports: ["internal"] },
        { id: "cred-b" },
      ],
      userVerification: "preferred",
    };
    const fetchFn = vi.fn(async () => jsonResponse(body));

    const options = await fetchAssertionOptions({
      url: SIGNAL_URL,
      credentialId: "cred-a",
      fetchFn,
    });

    // The exact endpoint/method/headers liquid-client's assertion.fetch uses.
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(`${SIGNAL_URL}/assertion/request/cred-a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(options.rpId).toBe("example.com");
    expect(options.allowCredentials).toEqual([
      { id: "cred-a", type: "public-key" },
      { id: "cred-b" },
    ]);
    expect(options.raw).toEqual(body);
  });

  it("passes options without rpId or allowCredentials through as raw only", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ challenge: "YQ" }));

    const options = await fetchAssertionOptions({
      url: SIGNAL_URL,
      credentialId: "cred-a",
      fetchFn,
    });

    expect(options.rpId).toBeUndefined();
    expect(options.allowCredentials).toBeUndefined();
    expect(options.raw).toEqual({ challenge: "YQ" });
  });

  it("throws a typed error on non-OK responses", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "nope" }, 404));

    try {
      await fetchAssertionOptions({ url: SIGNAL_URL, credentialId: "cred-a", fetchFn });
      expect.unreachable("fetchAssertionOptions must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LiquidAuthError);
      expect((e as LiquidAuthError).code).toBe("assertion_request_failed");
    }
  });
});
