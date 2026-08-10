/**
 * @module ows/chains
 *
 * CAIP-2 ↔ OWS chain-family resolution.
 *
 * OWS reports an account's chain as a CAIP-2 identifier (`"eip155:1"`,
 * `"solana:5eykt4…"`) but accepts a coarse *family* wherever a `chain` argument
 * is expected (`"evm"`, `"solana"`, …). The access layer MUST resolve a request
 * to a canonical chain identifier before signing, so this module keeps that
 * resolution in one pure place rather than scattering string surgery through
 * the engine.
 */

import type { OwsChainFamily, OwsCurve } from "./types.ts";

/** CAIP-2 namespace → the OWS chain family that serves it. */
export const CHAIN_FAMILIES: Readonly<Record<string, OwsChainFamily>> = {
  eip155: "evm",
  solana: "solana",
  bip122: "bitcoin",
  cosmos: "cosmos",
  tron: "tron",
  ton: "ton",
  sui: "sui",
  xrpl: "xrpl",
  fil: "filecoin",
};

/** The OWS chain families backed by Ed25519; every other family is secp256k1. */
export const ED25519_FAMILIES: readonly OwsChainFamily[] = ["solana", "sui", "ton"];

/**
 * Resolves the OWS chain family of a CAIP-2 chain id.
 *
 * Unknown namespaces are passed through untouched: OWS accepts aliases and bare
 * EVM chain ids too, and a namespace this package has not heard of yet should
 * reach the access layer rather than be rejected here.
 *
 * @param chainId - A CAIP-2 chain id, alias or family.
 * @returns The OWS chain family to send along a request.
 *
 * @example
 * ```typescript
 * chainFamily("eip155:8453"); // => "evm"
 * chainFamily("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"); // => "solana"
 * ```
 */
export function chainFamily(chainId: string): OwsChainFamily {
  const namespace = chainId.split(":")[0] ?? chainId;
  return CHAIN_FAMILIES[namespace] ?? namespace;
}

/**
 * Resolves the signature curve of a CAIP-2 chain id.
 *
 * @param chainId - A CAIP-2 chain id, alias or family.
 * @returns `"ed25519"` for the Ed25519 families, `"secp256k1"` otherwise.
 *
 * @example
 * ```typescript
 * chainCurve("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"); // => "ed25519"
 * chainCurve("eip155:1"); // => "secp256k1"
 * ```
 */
export function chainCurve(chainId: string): OwsCurve {
  return ED25519_FAMILIES.includes(chainFamily(chainId)) ? "ed25519" : "secp256k1";
}
