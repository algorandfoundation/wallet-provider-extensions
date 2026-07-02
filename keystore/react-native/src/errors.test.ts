import { describe, expect, it } from "vitest";
import { DecodingError, EncodingError, MasterKeyNotFoundError, UnlockingError } from "./errors.ts";

describe("errors.ts", () => {
  it("DecodingError sets name and message", () => {
    const error = new DecodingError("test message");
    expect(error.message).toBe("test message");
    expect(error.name).toBe("DecodingError");
  });

  it("DecodingError sets cause if provided", () => {
    const cause = new Error("cause");
    const error = new DecodingError("msg", cause);
    expect(error.cause).toBe(cause);
  });

  it("EncodingError sets name and message", () => {
    const error = new EncodingError("test message");
    expect(error.message).toBe("test message");
    expect(error.name).toBe("EncodingError");
  });

  it("UnlockingError sets name and message", () => {
    const error = new UnlockingError("test message");
    expect(error.message).toBe("test message");
    expect(error.name).toBe("UnlockingError");
  });

  it("MasterKeyNotFoundError sets name and message", () => {
    const error = new MasterKeyNotFoundError();
    expect(error.message).toBe("Master key not found");
    expect(error.name).toBe("MasterKeyNotFoundError");
  });
});
