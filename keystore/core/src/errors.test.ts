import { describe, expect, it } from "vitest";
import {
  DuplicateKeyIdError,
  InvalidKeyDataError,
  InvalidKeyFormatError,
  KeyGenerationNotSupportedError,
  KeyNotFoundError,
  KeyStoreError,
  MaterialAccessError,
} from "./errors.ts";

describe("errors.ts", () => {
  it("KeyStoreError sets name and message", () => {
    const error = new KeyStoreError("test message", "TestError");
    expect(error.message).toBe("test message");
    expect(error.name).toBe("TestError");
  });

  it("KeyStoreError sets cause if provided", () => {
    const cause = new Error("cause");
    const error = new KeyStoreError("msg", "Name", cause);
    expect(error.cause).toBe(cause);
  });

  it("KeyNotFoundError formats message with keyId", () => {
    const error = new KeyNotFoundError("k1");
    expect(error.message).toBe("Key not found: k1");
    expect(error.name).toBe("KeyNotFoundError");
  });

  it("KeyGenerationNotSupportedError formats message with algorithm", () => {
    const error = new KeyGenerationNotSupportedError("alg1");
    expect(error.message).toBe("Key generation not supported for algorithm: alg1");
    expect(error.name).toBe("KeyGenerationNotSupportedError");
  });

  it("InvalidKeyFormatError formats message with format", () => {
    const error = new InvalidKeyFormatError("fmt1");
    expect(error.message).toBe("Invalid key format: fmt1");
    expect(error.name).toBe("InvalidKeyFormatError");
  });

  it("DuplicateKeyIdError formats message with keyId", () => {
    const error = new DuplicateKeyIdError("k2");
    expect(error.message).toBe("Duplicate key ID: k2");
    expect(error.name).toBe("DuplicateKeyIdError");
  });

  it("InvalidKeyDataError formats message with reason", () => {
    const error = new InvalidKeyDataError("reason1");
    expect(error.message).toBe("Invalid key data: reason1");
    expect(error.name).toBe("InvalidKeyDataError");
  });

  it("MaterialAccessError formats message with reason", () => {
    const error = new MaterialAccessError("reason2");
    expect(error.message).toBe("Material access denied: reason2");
    expect(error.name).toBe("MaterialAccessError");
    expect(error).toBeInstanceOf(KeyStoreError);
  });
});
