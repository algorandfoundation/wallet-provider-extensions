import { describe, it, expect } from "vitest";
import { DigitalCredentialsUnsupportedError } from "@algorandfoundation/credentials-core";
import { nodeDigitalCredentials } from "./platform.ts";

describe("nodeDigitalCredentials", () => {
  it("reports unsupported", () => {
    expect(nodeDigitalCredentials.isSupported()).toBe(false);
  });

  it("rejects get with DigitalCredentialsUnsupportedError", async () => {
    const error = await nodeDigitalCredentials
      .get({ requests: [{ protocol: "openid4vp-v1-unsigned", data: {} }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DigitalCredentialsUnsupportedError);
    expect((error as DigitalCredentialsUnsupportedError).platform).toBe("node");
  });

  it("rejects create with DigitalCredentialsUnsupportedError", async () => {
    await expect(
      nodeDigitalCredentials.create({ requests: [{ protocol: "openid4vci", data: {} }] }),
    ).rejects.toBeInstanceOf(DigitalCredentialsUnsupportedError);
  });
});
