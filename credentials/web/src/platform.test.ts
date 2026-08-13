import { describe, it, expect } from "vitest";
import { DigitalCredentialsUnsupportedError } from "@algorandfoundation/credentials-core";
import { webDigitalCredentials } from "./platform.ts";

describe("webDigitalCredentials", () => {
  it("reports unsupported", () => {
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
