/**
 * Minimal Algorand address codec for the Liquid Auth protocol.
 *
 * The liquid-auth service identifies wallets by their canonical
 * 58-character Algorand address: base32 of the 32-byte ed25519 public
 * key followed by a 4-byte sha512/256 checksum. Wallet hosts often key
 * accounts by the raw public key instead (e.g. the base64 addresses of
 * keystore-bridged account stores), so the seams that put an address on
 * the wire normalize through {@link toAlgorandAddress}. Implemented
 * over `@scure/base` + `@noble/hashes` so the protocol package stays
 * free of an `algosdk` dependency.
 */

import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32, base64 } from "@scure/base";

import { LiquidAuthError } from "./errors.ts";

/** Byte length of an ed25519 public key. */
const PUBLIC_KEY_LENGTH = 32;

/** Byte length of the address checksum (the sha512/256 digest tail). */
const CHECKSUM_LENGTH = 4;

/** Character length of a canonical Algorand address. */
export const ALGORAND_ADDRESS_LENGTH = 58;

/** The 4-byte checksum of a public key: the tail of its sha512/256 digest. */
function checksumOf(publicKey: Uint8Array): Uint8Array {
  return sha512_256(publicKey).slice(-CHECKSUM_LENGTH);
}

/**
 * Encodes a 32-byte ed25519 public key as a canonical Algorand address.
 *
 * @param publicKey - The 32-byte ed25519 public key.
 * @returns The 58-character checksummed address.
 * @throws LiquidAuthError `invalid_address` when the key is not 32 bytes.
 */
export function encodeAlgorandAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new LiquidAuthError(
      "invalid_address",
      `an Algorand public key is ${PUBLIC_KEY_LENGTH} bytes, got ${publicKey.length}`,
    );
  }
  const bytes = new Uint8Array(PUBLIC_KEY_LENGTH + CHECKSUM_LENGTH);
  bytes.set(publicKey);
  bytes.set(checksumOf(publicKey), PUBLIC_KEY_LENGTH);
  return base32.encode(bytes).replace(/=+$/, "");
}

/**
 * Decodes a canonical Algorand address back to its 32-byte public key,
 * verifying the checksum.
 *
 * @param address - The 58-character address.
 * @returns The 32-byte ed25519 public key.
 * @throws LiquidAuthError `invalid_address` when the address is not
 *   58 characters of base32 or its checksum does not match.
 */
export function decodeAlgorandAddress(address: string): Uint8Array {
  if (address.length !== ALGORAND_ADDRESS_LENGTH) {
    throw new LiquidAuthError(
      "invalid_address",
      `an Algorand address is ${ALGORAND_ADDRESS_LENGTH} characters, got ${address.length}`,
    );
  }
  let decoded: Uint8Array;
  try {
    decoded = base32.decode(`${address.toUpperCase()}======`);
  } catch {
    throw new LiquidAuthError("invalid_address", "address is not valid base32");
  }
  const publicKey = decoded.slice(0, PUBLIC_KEY_LENGTH);
  const checksum = decoded.slice(PUBLIC_KEY_LENGTH);
  const expected = checksumOf(publicKey);
  if (checksum.length !== CHECKSUM_LENGTH || !expected.every((byte, i) => byte === checksum[i])) {
    throw new LiquidAuthError("invalid_address", "address checksum mismatch");
  }
  return publicKey;
}

/**
 * Whether `value` is a valid (checksummed) canonical Algorand address.
 *
 * @param value - The candidate string.
 * @returns `true` when {@link decodeAlgorandAddress} accepts it.
 */
export function isAlgorandAddress(value: string): boolean {
  try {
    decodeAlgorandAddress(value);
    return true;
  } catch {
    return false;
  }
}

/** Parses a base64/base64url string into a 32-byte public key, or `null`. */
function publicKeyFromBase64(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const bytes = base64.decode(padded);
    return bytes.length === PUBLIC_KEY_LENGTH ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes a wallet-supplied account identifier to a canonical
 * Algorand address. Accepts a raw 32-byte public key, an already
 * canonical 58-character address (returned as-is), or a base64/base64url
 * encoding of the public key (the address shape keystore-bridged account
 * stores commonly use).
 *
 * @param value - The public key or address in any accepted shape.
 * @returns The canonical 58-character Algorand address.
 * @throws LiquidAuthError `invalid_address` when `value` is none of the
 *   accepted shapes.
 */
export function toAlgorandAddress(value: string | Uint8Array): string {
  if (typeof value !== "string") {
    return encodeAlgorandAddress(value);
  }
  if (isAlgorandAddress(value)) {
    return value;
  }
  const publicKey = publicKeyFromBase64(value);
  if (publicKey) {
    return encodeAlgorandAddress(publicKey);
  }
  throw new LiquidAuthError(
    "invalid_address",
    "expected an Algorand address or a (base64) 32-byte ed25519 public key",
  );
}
