/**
 * A small, self-contained Algo25 (Algorand 25-word mnemonic) implementation.
 *
 * Algo25 is a **reversible** encoding of a 32-byte seed: 24 words of 11 bits
 * each (the seed) plus a checksum word derived from `sha512_256(seed)[0..2]`.
 * Unlike BIP39 there is no PBKDF2 step — the mnemonic *is* the seed.
 *
 * @remarks
 * This is a deliberately minimal implementation so the keystore can enable the
 * `Algo25` shim out of the box (see {@link createAlgo25Binding}). It uses the
 * BIP39 English wordlist, matching the wallet example's demo helpers. It is
 * **not** a hardened, audited replacement for `algosdk.mnemonic` and is meant
 * to be swapped for a canonical package binding once one is available.
 */

import { sha512_256 } from "@noble/hashes/sha2.js";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";

import type { Algo25Binding } from "./shims/index.ts";
import { ALGO25_SEED_LENGTH } from "./shims/index.ts";

/** Packs a byte array into a list of 11-bit little-endian word indices. */
function bytesTo11Bit(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer |= b << bits;
    bits += 8;
    if (bits >= 11) {
      out.push(buffer & 0x7ff);
      buffer >>>= 11;
      bits -= 11;
    }
  }
  if (bits > 0) out.push(buffer & 0x7ff);
  return out;
}

/** Unpacks a list of 11-bit word indices back into `byteLen` bytes. */
function elevenBitToBytes(words: number[], byteLen = ALGO25_SEED_LENGTH): Uint8Array {
  const out = new Uint8Array(byteLen);
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const w of words) {
    buffer |= (w & 0x7ff) << bits;
    bits += 11;
    while (bits >= 8 && i < byteLen) {
      out[i++] = buffer & 0xff;
      buffer >>>= 8;
      bits -= 8;
    }
  }
  return out;
}

/** Encodes a 32-byte seed as a 25-word Algo25 mnemonic. */
function seedToMnemonic(seed: Uint8Array): string {
  if (seed.length !== ALGO25_SEED_LENGTH) {
    throw new RangeError(`Algo25 seed must be ${ALGO25_SEED_LENGTH} bytes, got ${seed.length}`);
  }
  const indices = bytesTo11Bit(seed).slice(0, 24);
  const checksum = bytesTo11Bit(sha512_256(seed))[0]!;
  return [...indices, checksum].map((idx) => englishWordlist[idx]!).join(" ");
}

/** Decodes a 25-word Algo25 mnemonic back to its 32-byte seed. */
function mnemonicToSeed(mnemonic: string): Uint8Array {
  const words = mnemonic.trim().split(/\s+/);
  const indices = words.map((w) => englishWordlist.indexOf(w));
  return elevenBitToBytes(indices.slice(0, 24), ALGO25_SEED_LENGTH);
}

/**
 * Builds a small {@link Algo25Binding} backed by the BIP39 English wordlist.
 *
 * Intended as a sensible default so the `Algo25` shim works without the caller
 * supplying a binding. Replace it with a canonical (`algosdk`-compatible)
 * binding when one is packaged.
 *
 * @returns An {@link Algo25Binding}.
 */
export function createAlgo25Binding(): Algo25Binding {
  return {
    generateMnemonic: () =>
      seedToMnemonic(globalThis.crypto.getRandomValues(new Uint8Array(ALGO25_SEED_LENGTH))),
    seedToMnemonic,
    mnemonicToSeed,
  };
}
