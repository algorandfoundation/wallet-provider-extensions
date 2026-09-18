/**
 * Minimal Algorand-style 25-word mnemonic ("Algo25") helpers.
 *
 * Encodes a 32-byte seed as 24 words of 11 bits each, plus a 25th
 * checksum word derived from `sha512_256(seed)[:2]` (first 11 bits).
 *
 * The wordlist is intentionally the BIP39 English 2048-word list, the
 * same list Algorand's `algosdk` mnemonic uses. This module is a small
 * demonstration of an alternative seed-phrase scheme alongside BIP39
 * and is NOT a drop-in replacement for `algosdk.mnemonic`.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** Pack a Uint8Array into an array of 11-bit unsigned integers. */
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

/** Inverse of {@link bytesTo11Bit} for a fixed `byteLen` of 32. */
function elevenBitToBytes(words: number[], byteLen = 32): Uint8Array {
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

/**
 * Encode a 32-byte seed as a 25-word Algo25 mnemonic.
 *
 * @example
 * ```ts
 * const phrase = seedToAlgo25Mnemonic(seedBytes);
 * ```
 */
export function seedToAlgo25Mnemonic(seed: Uint8Array): string {
  if (seed.length !== 32) {
    throw new Error(`Algo25 seed must be 32 bytes, got ${seed.length}`);
  }
  const indices = bytesTo11Bit(seed).slice(0, 24);
  const checksum = bytesTo11Bit(sha512_256(seed))[0]!;
  const all = [...indices, checksum];
  return all.map((idx) => wordlist[idx]!).join(" ");
}

/**
 * Decode a 25-word Algo25 mnemonic back to a 32-byte seed.
 *
 * @example
 * ```ts
 * const seed = algo25MnemonicToSeed("word1 word2 ... word25");
 * ```
 */
export function algo25MnemonicToSeed(mnemonic: string): Uint8Array {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 25) {
    throw new Error(`Algo25 mnemonic must be 25 words, got ${words.length}`);
  }
  const indices = words.map((w) => {
    const i = wordlist.indexOf(w);
    if (i < 0) throw new Error(`Unknown Algo25 word: ${w}`);
    return i;
  });
  const seed = elevenBitToBytes(indices.slice(0, 24), 32);
  const expected = bytesTo11Bit(sha512_256(seed))[0]!;
  if (expected !== indices[24]) {
    throw new Error("Algo25 checksum mismatch");
  }
  return seed;
}
