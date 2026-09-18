import { describe, expect, it } from "vitest";

import {
  ALGORAND_ADDRESS_LENGTH,
  decodeAlgorandAddress,
  encodeAlgorandAddress,
  isAlgorandAddress,
  toAlgorandAddress,
} from "./address.ts";
import { LiquidAuthError } from "./errors.ts";

// The canonical address of the all-zeros public key (a well-known
// algosdk test vector).
const ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const ZERO_KEY = new Uint8Array(32);

/** Plain base64 of `bytes` (the keystore-bridged account address shape). */
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("encodeAlgorandAddress", () => {
  it("encodes a 32-byte public key as the canonical checksummed address", () => {
    const address = encodeAlgorandAddress(ZERO_KEY);
    expect(address).toBe(ZERO_ADDRESS);
    expect(address).toHaveLength(ALGORAND_ADDRESS_LENGTH);
  });

  it("round-trips through decodeAlgorandAddress", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
    expect(decodeAlgorandAddress(encodeAlgorandAddress(publicKey))).toEqual(publicKey);
  });

  it("rejects a public key that is not 32 bytes", () => {
    expect(() => encodeAlgorandAddress(new Uint8Array(31))).toThrowError(LiquidAuthError);
    expect(() => encodeAlgorandAddress(new Uint8Array(31))).toThrowError(/32 bytes/);
  });
});

describe("decodeAlgorandAddress", () => {
  it("rejects a wrong-length string with the typed error", () => {
    try {
      decodeAlgorandAddress(toBase64(ZERO_KEY));
      expect.unreachable("decode must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LiquidAuthError);
      expect((e as LiquidAuthError).code).toBe("invalid_address");
      expect((e as LiquidAuthError).message).toMatch(/58 characters, got 44/);
    }
  });

  it("rejects a checksum mismatch", () => {
    // Flip the last character of a valid address.
    const corrupted = `${ZERO_ADDRESS.slice(0, -1)}A`;
    expect(() => decodeAlgorandAddress(corrupted)).toThrowError(/checksum/);
  });

  it("rejects non-base32 input of the right length", () => {
    expect(() => decodeAlgorandAddress("1".repeat(58))).toThrowError(/base32/);
  });
});

describe("isAlgorandAddress", () => {
  it("accepts a canonical address and rejects everything else", () => {
    expect(isAlgorandAddress(ZERO_ADDRESS)).toBe(true);
    expect(isAlgorandAddress(toBase64(ZERO_KEY))).toBe(false);
    expect(isAlgorandAddress("")).toBe(false);
  });
});

describe("toAlgorandAddress", () => {
  it("passes a canonical address through unchanged", () => {
    expect(toAlgorandAddress(ZERO_ADDRESS)).toBe(ZERO_ADDRESS);
  });

  it("encodes a raw 32-byte public key", () => {
    expect(toAlgorandAddress(ZERO_KEY)).toBe(ZERO_ADDRESS);
  });

  it("converts a base64 public key (padded and unpadded)", () => {
    expect(toAlgorandAddress(toBase64(ZERO_KEY))).toBe(ZERO_ADDRESS);
    expect(toAlgorandAddress(toBase64(ZERO_KEY).replace(/=+$/, ""))).toBe(ZERO_ADDRESS);
  });

  it("converts a base64url public key", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3);
    const base64url = toBase64(publicKey)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(toAlgorandAddress(base64url)).toBe(encodeAlgorandAddress(publicKey));
  });

  it("rejects values that are neither an address nor a 32-byte key", () => {
    for (const value of ["WALLET", toBase64(new Uint8Array(16)), "not base64!!"]) {
      try {
        toAlgorandAddress(value);
        expect.unreachable("normalize must throw");
      } catch (e) {
        expect(e).toBeInstanceOf(LiquidAuthError);
        expect((e as LiquidAuthError).code).toBe("invalid_address");
      }
    }
  });
});
