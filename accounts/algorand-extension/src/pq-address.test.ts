import { describe, expect, it } from "vitest";
import { generateKey } from "falcon-1024";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import {
  canonicalPQAddress,
  isEdwards25519Point,
  pqAddress,
  PQ_SCHEME_FALCON1024,
} from "./pq-address.ts";

/**
 * Canonical Algorand string of 32 address bytes (base32 of address ||
 * 4-byte sha512_256 checksum, unpadded), which is how go-algorand's
 * `Address.String()` renders the known-answer vectors below.
 */
function encodeAlgorandAddress(address: Uint8Array): string {
  const checksum = sha512_256(address).slice(-4);
  const full = new Uint8Array(address.length + checksum.length);
  full.set(address, 0);
  full.set(checksum, address.length);
  return base32.encode(full).replace(/=+$/, "");
}

/** Deterministic Falcon-1024 public key from a 32-byte seed (go's `FalconSeed`). */
function falconPublicKey(firstSeedByte: number): Uint8Array {
  const seed = new Uint8Array(32);
  seed[0] = firstSeedByte;
  return generateKey(seed).publicKey;
}

describe("pqAddress", () => {
  // The known-answer vectors of go-algorand v5's `TestPQAddressKnownAnswers`
  // (data/basics/pq_address_test.go): deterministic Falcon-1024 keys from a
  // seed with only the first byte set, addressed under an explicit salt.
  const KNOWN_ANSWERS: {
    name: string;
    firstSeedByte: number;
    salt: number;
    expectedAddress: string;
    compliant: boolean;
  }[] = [
    {
      name: "zero salt",
      firstSeedByte: 3,
      salt: 0,
      expectedAddress: "KJGJA2DTCQH6LT2I2OH2YO5GIIBFC6JHX5O6UPA5ZZ5ZURFT3LHKMTRCEM",
      compliant: true,
    },
    {
      name: "nonzero salt",
      firstSeedByte: 1,
      salt: 1,
      expectedAddress: "GYBWVYVQIQF6CO7BUMG4UQ66DQYHASFOCA2P7PBYOIPKGWUZIBX4KA3TP4",
      compliant: true,
    },
    {
      name: "max salt",
      firstSeedByte: 0,
      salt: 255,
      expectedAddress: "YJFADDEP6Z3WAWY6ZMLN6MF4T4NK3BXKCVLPCYB6C4SQHE76LLQSZ5JG7Q",
      compliant: true,
    },
    {
      name: "different seed",
      firstSeedByte: 2,
      salt: 2,
      expectedAddress: "II4DO6IIP3EAEQMWJEOLOUU3VBRVCH3WF4MX6UCRUD36DOQJ3YSHA2DV5A",
      compliant: true,
    },
    {
      name: "max seed and salt",
      firstSeedByte: 255,
      salt: 255,
      expectedAddress: "3JXWI6BYYEO6WO6M7TC4SOZAZUWAD4RQO5GJ2ED6MYIEVVLOVJOETMGG4A",
      compliant: true,
    },
    {
      name: "non-compliant on-curve address",
      firstSeedByte: 1,
      salt: 0,
      expectedAddress: "FLX4VRWXQ65HD5G5BI2EPHJWMERHA2EBBQ7XMTZLATXH4XEOWPQSIYVIF4",
      compliant: false,
    },
  ];

  it.each(KNOWN_ANSWERS)(
    "matches the go-algorand known answer: $name",
    ({ firstSeedByte, salt, expectedAddress, compliant }) => {
      const publicKey = falconPublicKey(firstSeedByte);
      const address = pqAddress(PQ_SCHEME_FALCON1024, salt, publicKey);
      expect(encodeAlgorandAddress(address)).toBe(expectedAddress);
      // `IsPQCompliant` = the address is NOT an Edwards25519 point.
      expect(isEdwards25519Point(address)).toBe(!compliant);
    },
  );
});

describe("canonicalPQAddress", () => {
  it("scans to the lowest PQ-compliant salt (go-algorand's TestCanonicalPQAddressSalt)", () => {
    // Salt 0 of this key digests to a curve point (the non-compliant vector
    // above), so the canonical salt is 1.
    const publicKey = falconPublicKey(1);
    const { address, salt } = canonicalPQAddress(publicKey);
    expect(salt).toBe(1);
    expect(encodeAlgorandAddress(address)).toBe(
      "GYBWVYVQIQF6CO7BUMG4UQ66DQYHASFOCA2P7PBYOIPKGWUZIBX4KA3TP4",
    );
    expect(isEdwards25519Point(address)).toBe(false);
  });

  it("starts at salt 0 when it is already compliant", () => {
    const { address, salt } = canonicalPQAddress(falconPublicKey(3));
    expect(salt).toBe(0);
    expect(encodeAlgorandAddress(address)).toBe(
      "KJGJA2DTCQH6LT2I2OH2YO5GIIBFC6JHX5O6UPA5ZZ5ZURFT3LHKMTRCEM",
    );
  });

  it("does not require a registered scheme or a validated key", () => {
    // Mirrors go-algorand's arbitrary-scheme/short-key test: derivation is a
    // pure digest scan, so any bytes address deterministically.
    const publicKey = new Uint8Array([0xab, 0xcd, 0xef]);
    const first = canonicalPQAddress(publicKey, "x1");
    const again = canonicalPQAddress(publicKey, "x1");
    expect(first.salt).toBe(again.salt);
    expect(first.address).toEqual(again.address);
    expect(first.address).toEqual(pqAddress("x1", first.salt, publicKey));
    for (let lower = 0; lower < first.salt; lower += 1) {
      expect(isEdwards25519Point(pqAddress("x1", lower, publicKey))).toBe(true);
    }
  });
});
