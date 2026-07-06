import * as Keychain from "react-native-keychain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MasterKeyNotFoundError, UnlockingError } from "../errors.js";
import { createMasterKey, decryptData, encryptData, readMasterKey } from "./crypto.js";

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

  it("should encrypt and decrypt data", () => {
    const key = Buffer.alloc(32, 1);
    const data = "secret-message";
    const encrypted = encryptData(key, data);
    const decrypted = decryptData(key, encrypted);
    expect(decrypted).toBe(data);
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

  it("should reuse a recently authenticated biometric master key", async () => {
    const storedKey = Buffer.alloc(32, 3).toString("hex");
    vi.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
      password: storedKey,
      username: "master",
      service: "app-secret",
      storage: "best",
    });

    const firstKey = await readMasterKey({ biometrics: true });
    firstKey.fill(0);

    const secondKey = await readMasterKey({ biometrics: true });

    expect(Keychain.getGenericPassword).toHaveBeenCalledOnce();
    expect(secondKey.toString("hex")).toBe(storedKey);
  });
});
