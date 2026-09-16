/**
 * Per-key-type Algorand address derivation.
 *
 * Each supported keystore key type maps to an {@link AlgorandAddressEncoder}
 * that turns the key into a concrete Algorand address (plus any
 * address-scheme metadata worth recording on the account). The map is the
 * extensibility seam for future account kinds — e.g. Falcon LSIG accounts
 * or the upcoming HybridLsig (Ed25519 + Falcon-1024) — which plug in as new
 * encoders without changing the account shape or the extension's flow.
 */
import type { Key } from "@algorandfoundation/keystore-core";
import { encodeAddress } from "algosdk";
import { PQ_SCHEME_FALCON1024, canonicalPQAddress } from "./pq-address.ts";

/** The result of encoding a key into an Algorand address. */
export interface EncodedAlgorandAddress {
  /** The 58-character Algorand address string. */
  address: string;
  /**
   * Address-scheme metadata to merge into the account's metadata
   * (e.g. `pqScheme` / `pqSalt` for post-quantum addresses).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Derives the Algorand address (and any scheme metadata) for a key, or
 * `undefined` when the key cannot be represented as an Algorand account.
 */
export type AlgorandAddressEncoder = (key: Key) => EncodedAlgorandAddress | undefined;

/**
 * Ed25519 public keys ARE Algorand addresses: the address is the standard
 * checksummed base32 encoding of the 32-byte public key.
 */
const ed25519Encoder: AlgorandAddressEncoder = (key) => {
  if (!key.publicKey) return undefined;
  return { address: encodeAddress(key.publicKey) };
};

/**
 * Falcon-1024 public keys are far too large to be addresses, so the address
 * is go-algorand v5's canonical PQ digest of the key
 * ({@link canonicalPQAddress}), encoded as a standard Algorand address. The
 * scheme and salt are recorded so the preimage stays reconstructible.
 */
const falcon1024Encoder: AlgorandAddressEncoder = (key) => {
  if (!key.publicKey) return undefined;
  const { address, salt } = canonicalPQAddress(key.publicKey);
  return {
    address: encodeAddress(address),
    metadata: { pqScheme: PQ_SCHEME_FALCON1024, pqSalt: salt },
  };
};

/**
 * The supported key types and their encoders. Future account kinds
 * (falcon LSIG, HybridLsig) land here as additional entries.
 */
export const ALGORAND_ADDRESS_ENCODERS: Readonly<Record<string, AlgorandAddressEncoder>> = {
  "hd-derived-ed25519": ed25519Encoder,
  ed25519: ed25519Encoder,
  "falcon-1024": falcon1024Encoder,
};

/**
 * Derives the Algorand address for a keystore key via the encoder map.
 *
 * HD-derived keys must live in the Algorand address context
 * (`metadata.context === 0`) — identity-context keys are never accounts.
 * Keys of unsupported types (or missing a public key) return `undefined`
 * and are skipped by the extension.
 */
export function algorandAddressForKey(key: Key): EncodedAlgorandAddress | undefined {
  if (key.type === "hd-derived-ed25519" && key.metadata?.context !== 0) {
    return undefined;
  }
  return ALGORAND_ADDRESS_ENCODERS[key.type]?.(key);
}
