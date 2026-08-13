import { describe, it, expect } from "vitest";
import { DigitalCredentialsUnsupportedError } from "@algorandfoundation/credentials-core";
import { reactNativeDigitalCredentials } from "./platform.ts";

describe("reactNativeDigitalCredentials", () => {
  it("reports unsupported", () => {
    expect(reactNativeDigitalCredentials.isSupported()).toBe(false);
  });

  it("rejects get with DigitalCredentialsUnsupportedError", async () => {
    const error = await reactNativeDigitalCredentials
      .get({ requests: [{ protocol: "openid4vp-v1-unsigned", data: {} }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DigitalCredentialsUnsupportedError);
    expect((error as DigitalCredentialsUnsupportedError).platform).toBe("react-native");
  });

  it("rejects create with DigitalCredentialsUnsupportedError", async () => {
    await expect(
      reactNativeDigitalCredentials.create({ requests: [{ protocol: "openid4vci", data: {} }] }),
    ).rejects.toBeInstanceOf(DigitalCredentialsUnsupportedError);
  });
});
