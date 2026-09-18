import { describe, expect, it } from "vitest";

import { rawX25519PublicKey } from "./types.ts";

describe("rawX25519PublicKey", () => {
  /** The RFC 8410 SPKI header the keystore's `Key.publicKey` carries. */
  const SPKI_PREFIX = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
  ]);

  it("passes a raw 32-byte key through unchanged", () => {
    const raw = new Uint8Array(32).fill(3);
    expect(rawX25519PublicKey(raw)).toEqual(raw);
  });

  it("unwraps the SPKI document the keystore records for host keys", () => {
    const raw = new Uint8Array(32).fill(4);
    const spki = new Uint8Array(SPKI_PREFIX.length + 32);
    spki.set(SPKI_PREFIX);
    spki.set(raw, SPKI_PREFIX.length);

    expect(rawX25519PublicKey(spki)).toEqual(raw);
  });

  it("rejects bytes that are neither raw nor an X25519 SPKI", () => {
    expect(() => rawX25519PublicKey(new Uint8Array(16))).toThrow(/X25519/);
    expect(() => rawX25519PublicKey(new Uint8Array(44))).toThrow(/X25519/);
  });
});
