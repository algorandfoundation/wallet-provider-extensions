/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/algorand-accounts-extension` is the production Algorand
 * accounts bridge. The {@link WithAlgorandAccounts} extension subscribes to
 * the keystore, turns compatible keys into {@link AlgorandAccount} records
 * with **concrete Algorand addresses** (ed25519 public keys, go-algorand v5
 * canonical post-quantum digests for Falcon-1024), seeds their balances and
 * assets from algod and keeps them live through a contained
 * algokit-subscriber watchlist. It owns the `options.algorand` namespace
 * ({@link AlgorandNamespace}) and mounts the shared algod / indexer clients
 * at `provider.algorand`.
 *
 * The addressing helpers (`algorandAddressForKey`, `canonicalPQAddress`,
 * `pqAddress`) and the balance helpers (`getAlgorandBalances`,
 * `createSubscriberWithWatchlist`) are pure functions that run fully
 * standalone, without a Provider, store or keystore.
 */

export * from "./address.ts";
export * from "./algorand.ts";
export * from "./extension.ts";
export * from "./pq-address.ts";
export * from "./types.ts";
