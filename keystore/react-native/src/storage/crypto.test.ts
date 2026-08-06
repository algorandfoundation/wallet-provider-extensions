import * as Keychain from "react-native-keychain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MasterKeyNotFoundError, UnlockingError } from "../errors.js";
import { createMasterKey, openData, readMasterKey, sealData } from "./crypto.js";

const subtle = globalThis.crypto.subtle;

describe("crypto storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await Keychain.resetGenericPassword();
  });

  it("should create a master key", async () => {
    const key = await createMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(Keychain.setGenericPassword).toHaveBeenCalledOnce();
  });

  it("should not create a master key while reading", async () => {
    await expect(readMasterKey()).rejects.toBeInstanceOf(MasterKeyNotFoundError);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it("should fail when the master key cannot be stored", async () => {
    vi.mocked(Keychain.setGenericPassword).mockResolvedValueOnce(false);
    await expect(createMasterKey()).rejects.toBeInstanceOf(UnlockingError);
  });

  it("should seal and open data", async () => {
    const key = Buffer.alloc(32, 1);
    const data = "secret-message";
    const sealed = await sealData(subtle, key, data);
    expect(sealed).not.toContain(data);
    const opened = await openData(subtle, key, sealed);
    expect(opened).toBe(data);
  });

  it("should produce a distinct IV/ciphertext for each seal call", async () => {
    const key = Buffer.alloc(32, 1);
    const data = "secret-message";
    const first = await sealData(subtle, key, data);
    const second = await sealData(subtle, key, data);
    expect(first).not.toBe(second);
  });

  it("should fail to open data sealed with a different key", async () => {
    const key = Buffer.alloc(32, 1);
    const otherKey = Buffer.alloc(32, 9);
    const sealed = await sealData(subtle, key, "secret-message");
    await expect(openData(subtle, otherKey, sealed)).rejects.toBeDefined();
  });

  it("should open a legacy {iv,tag,content} payload for transparent migration", async () => {
    const { createCipheriv } = await import("node:crypto");
    const key = Buffer.alloc(32, 1);
    const data = "legacy-secret";
    // Reproduce the old quick-crypto `encryptData` scheme: AES-256-GCM with the
    // auth tag stored separately from the (tag-less) ciphertext.
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let content = cipher.update(data, "utf8", "base64");
    content += cipher.final("base64");
    const legacy = JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      content,
    });

    const opened = await openData(subtle, key, legacy);
    expect(opened).toBe(data);
  });

  it("should use stored key if available", async () => {
    const storedKey = Buffer.alloc(32, 2).toString("hex");
    vi.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
      password: storedKey,
      username: "master",
      service: "app-secret",
      storage: "best",
    });

    const key = await readMasterKey();
    expect(key.toString("hex")).toBe(storedKey);
  });

  it("should never cache the master key in memory: every read hits the Keychain", async () => {
    const storedKey = Buffer.alloc(32, 3).toString("hex");
    const credentials = {
      password: storedKey,
      username: "master",
      service: "app-secret",
      storage: "best" as const,
    };
    vi.mocked(Keychain.getGenericPassword).mockResolvedValue(credentials);

    const firstKey = await readMasterKey({ biometrics: true });
    firstKey.fill(0);
    const secondKey = await readMasterKey({ biometrics: true });

    expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(2);
    expect(secondKey.toString("hex")).toBe(storedKey);
  });

  it("should store the master key with BIOMETRY_ANY by default", async () => {
    await createMasterKey({ biometrics: true });

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      "master",
      expect.any(String),
      expect.objectContaining({ accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY }),
    );
  });

  it("should store the master key with BIOMETRY_CURRENT_SET when opting in", async () => {
    await createMasterKey({ biometrics: true, invalidateOnEnrollment: true });

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      "master",
      expect.any(String),
      expect.objectContaining({ accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET }),
    );
  });

  it("should forward authenticationValidityDuration on both the read and create paths", async () => {
    await createMasterKey({ biometrics: true, authenticationValidityDuration: 120 });
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      "master",
      expect.any(String),
      expect.objectContaining({ authenticationValidityDuration: 120 }),
    );

    vi.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
      password: Buffer.alloc(32, 4).toString("hex"),
      username: "master",
      service: "app-secret",
      storage: "best",
    });
    await readMasterKey({ biometrics: true, authenticationValidityDuration: 120 });
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith(
      expect.objectContaining({ authenticationValidityDuration: 120 }),
    );
  });

  it("should use the built-in per-operation prompt when nothing else is configured", async () => {
    vi.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
      password: Buffer.alloc(32, 5).toString("hex"),
      username: "master",
      service: "app-secret",
      storage: "best",
    });

    await readMasterKey({ operation: "sign" });

    expect(Keychain.getGenericPassword).toHaveBeenCalledWith(
      expect.objectContaining({ authenticationPrompt: { title: "Authenticate to sign" } }),
    );
  });
});
