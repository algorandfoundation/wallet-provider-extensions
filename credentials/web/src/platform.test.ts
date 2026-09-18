import { afterEach, describe, expect, it, vi } from "vitest";
import { DigitalCredentialsUnsupportedError } from "@algorandfoundation/credentials-core";
import { webDigitalCredentials } from "./platform.ts";

/**
 * Installs a fake browser Digital Credentials API on `globalThis`:
 * the `DigitalCredential` interface object (feature-detection marker)
 * plus a `navigator.credentials` container.
 */
function stubDigitalCredentialsApi(container: {
  get?: (options: unknown) => Promise<unknown>;
  create?: (options: unknown) => Promise<unknown>;
}) {
  vi.stubGlobal("DigitalCredential", class DigitalCredential {});
  vi.stubGlobal("navigator", { credentials: container });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webDigitalCredentials (unsupported browser)", () => {
  it("reports unsupported when the DigitalCredential interface is missing", () => {
    expect(webDigitalCredentials.isSupported()).toBe(false);
  });

  it("reports unsupported when DigitalCredential exists but navigator.credentials is missing", () => {
    vi.stubGlobal("DigitalCredential", class DigitalCredential {});
    expect(webDigitalCredentials.isSupported()).toBe(false);
  });

  it("rejects get with DigitalCredentialsUnsupportedError", async () => {
    const error = await webDigitalCredentials
      .get({ requests: [{ protocol: "openid4vp-v1-unsigned", data: {} }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DigitalCredentialsUnsupportedError);
    expect((error as DigitalCredentialsUnsupportedError).platform).toBe("web");
  });

  it("rejects create with DigitalCredentialsUnsupportedError", async () => {
    await expect(
      webDigitalCredentials.create({ requests: [{ protocol: "openid4vci", data: {} }] }),
    ).rejects.toBeInstanceOf(DigitalCredentialsUnsupportedError);
  });
});

describe("webDigitalCredentials (supported browser)", () => {
  it("reports supported when the API is exposed", () => {
    stubDigitalCredentialsApi({ get: async () => null, create: async () => null });
    expect(webDigitalCredentials.isSupported()).toBe(true);
  });

  it("forwards get requests and the abort signal to navigator.credentials.get", async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ protocol: "openid4vp-v1-unsigned", data: { vp_token: "..." } });
    stubDigitalCredentialsApi({ get, create: async () => null });

    const requests = [{ protocol: "openid4vp-v1-unsigned", data: { nonce: "n" } }];
    const controller = new AbortController();
    const response = await webDigitalCredentials.get({ requests, signal: controller.signal });

    expect(get).toHaveBeenCalledWith({ digital: { requests }, signal: controller.signal });
    expect(response).toEqual({ protocol: "openid4vp-v1-unsigned", data: { vp_token: "..." } });
  });

  it("forwards create requests to navigator.credentials.create", async () => {
    const create = vi.fn().mockResolvedValue({ protocol: "openid4vci", data: { ok: true } });
    stubDigitalCredentialsApi({ get: async () => null, create });

    const requests = [{ protocol: "openid4vci", data: { offer: "..." } }];
    const response = await webDigitalCredentials.create({ requests });

    expect(create).toHaveBeenCalledWith({ digital: { requests }, signal: undefined });
    expect(response).toEqual({ protocol: "openid4vci", data: { ok: true } });
  });

  it("throws when the user agent does not return a DigitalCredential", async () => {
    stubDigitalCredentialsApi({ get: async () => null, create: async () => null });

    await expect(
      webDigitalCredentials.get({ requests: [{ protocol: "openid4vp-v1-unsigned", data: {} }] }),
    ).rejects.toThrow(/did not return a DigitalCredential/);
  });

  it("propagates user-agent rejections (e.g. user cancelled, issuance disabled)", async () => {
    const abort = new Error("The operation was aborted.");
    stubDigitalCredentialsApi({
      get: async () => {
        throw abort;
      },
      create: async () => null,
    });

    await expect(
      webDigitalCredentials.get({ requests: [{ protocol: "openid4vp-v1-unsigned", data: {} }] }),
    ).rejects.toBe(abort);
  });
});
