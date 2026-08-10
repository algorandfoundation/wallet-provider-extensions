/**
 * @module ows/store
 *
 * The pure store operations of the OWS adapter: the key-id encoding that maps
 * an OWS *wallet account* onto a keystore {@link Key}, the projection of an OWS
 * vault into UI-safe metadata, and the small reactive-store mutations the
 * engine performs.
 *
 * An OWS wallet holds one seed and derives one account per supported chain,
 * while the keystore's unit is a single key. The adapter therefore surfaces
 * **one key per account**, addressed as `ows/<walletId>/<chainId>`, so a
 * provider can list, select and sign with an individual chain account the same
 * way it does with a locally generated key. No secret material ever reaches
 * these records: OWS keeps custody of the seed.
 */

import type { Key, KeyId, KeyStoreState } from "@algorandfoundation/keystore-core";
import { InvalidKeyDataError, KeyNotFoundError } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";

import { chainCurve, chainFamily } from "./chains.ts";
import type { OwsAccount, OwsSignResult, OwsWalletInfo } from "./types.ts";

/** Prefix marking a keystore key as an OWS wallet account. */
export const OWS_KEY_PREFIX = "ows/";

/**
 * Builds the keystore {@link KeyId} of an OWS wallet account.
 *
 * @param walletId - The OWS wallet id (or name).
 * @param chainId - The CAIP-2 chain id of the account.
 * @returns The `ows/<walletId>/<chainId>` key id.
 *
 * @example
 * ```typescript
 * toKeyId("3198bc9c-...", "eip155:1"); // => "ows/3198bc9c-.../eip155:1"
 * ```
 */
export function toKeyId(walletId: string, chainId: string): KeyId {
  return `${OWS_KEY_PREFIX}${walletId}/${chainId}`;
}

/**
 * Splits a keystore {@link KeyId} back into the OWS wallet and chain it
 * addresses.
 *
 * @param id - An `ows/<walletId>/<chainId>` key id.
 * @returns The wallet id and the CAIP-2 chain id.
 * @throws {InvalidKeyDataError} If `id` is not an OWS key id.
 *
 * @example
 * ```typescript
 * parseKeyId("ows/3198bc9c-.../eip155:1");
 * // => { walletId: "3198bc9c-...", chainId: "eip155:1" }
 * ```
 */
export function parseKeyId(id: KeyId): { walletId: string; chainId: string } {
  if (!id.startsWith(OWS_KEY_PREFIX)) {
    throw new InvalidKeyDataError(`${id} is not an OWS key id`);
  }
  const rest = id.slice(OWS_KEY_PREFIX.length);
  const separator = rest.indexOf("/");
  if (separator <= 0 || separator === rest.length - 1) {
    throw new InvalidKeyDataError(`${id} is not an OWS key id`);
  }
  return { walletId: rest.slice(0, separator), chainId: rest.slice(separator + 1) };
}

/**
 * Projects one OWS account onto a UI-safe keystore {@link Key}.
 *
 * The record is metadata only — address, derivation path, chain and the owning
 * wallet — and is always `extractable: false`: the seed stays in the OWS vault,
 * and reading it back is an explicit `export`, never a property of the record.
 *
 * @param wallet - The wallet the account belongs to.
 * @param account - The account to project.
 * @returns The keystore metadata record for the account.
 */
export function toKey(wallet: OwsWalletInfo, account: OwsAccount): Key {
  const curve = chainCurve(account.chainId);
  return {
    id: toKeyId(wallet.id, account.chainId),
    type: curve === "ed25519" ? "ed25519" : "ecc",
    algorithm: curve === "ed25519" ? "EdDSA" : "ES256K",
    keyUsages: ["sign"],
    extractable: false,
    metadata: {
      source: "ows",
      walletId: wallet.id,
      walletName: wallet.name,
      chainId: account.chainId,
      chain: chainFamily(account.chainId),
      curve,
      address: account.address,
      derivationPath: account.derivationPath,
      ...(wallet.createdAt === undefined ? {} : { createdAt: wallet.createdAt }),
    },
    version: 1,
  };
}

/**
 * Projects a whole OWS vault into keystore metadata, one key per account.
 *
 * @param wallets - The wallets reported by the access layer.
 * @returns One {@link Key} per wallet account.
 *
 * @example
 * ```typescript
 * const keys = toKeys(await binding.listWallets());
 * ```
 */
export function toKeys(wallets: OwsWalletInfo[]): Key[] {
  return wallets.flatMap((wallet) => (wallet.accounts ?? []).map((a) => toKey(wallet, a)));
}

/**
 * Replaces the reactive store's key list with `keys`, leaving the rest of the
 * state untouched.
 *
 * @param store - The reactive keystore state store.
 * @param keys - The metadata records to publish.
 */
export function setKeys(store: Store<KeyStoreState>, keys: Key[]): void {
  store.setState((state) => ({ ...state, keys }));
}

/**
 * Publishes the keystore's operation status (`"idle"`, `"signing"`, …).
 *
 * @param store - The reactive keystore state store.
 * @param status - The status to publish.
 */
export function setStatus(store: Store<KeyStoreState>, status: string): void {
  store.setState((state) => ({ ...state, status }));
}

/**
 * Reads a key's metadata out of the reactive store.
 *
 * @param store - The reactive keystore state store.
 * @param id - The {@link KeyId} to look up.
 * @returns The metadata record.
 * @throws {KeyNotFoundError} If the vault holds no such account.
 */
export function selectKey(store: Store<KeyStoreState>, id: KeyId): Key {
  const key = store.state.keys.find((candidate) => candidate.id === id);
  if (!key) throw new KeyNotFoundError(id);
  return key;
}

/** Reads `field` from a loosely-typed record, accepting a `snake_case` alias. */
function field(record: Record<string, unknown>, name: string, alias: string): unknown {
  return record[name] ?? record[alias];
}

/**
 * Normalizes a wallet descriptor coming off an OWS access layer.
 *
 * The NAPI bindings return camelCase objects while the CLI's JSON output uses
 * `snake_case`; both are accepted so the {@link OwsBinding} contract stays
 * identical across access profiles.
 *
 * @param value - The raw descriptor reported by the access layer.
 * @returns The normalized {@link OwsWalletInfo}.
 * @throws {InvalidKeyDataError} If the payload is not a wallet descriptor.
 */
export function toWalletInfo(value: unknown): OwsWalletInfo {
  if (typeof value !== "object" || value === null) {
    throw new InvalidKeyDataError("OWS returned a malformed wallet descriptor");
  }
  const record = value as Record<string, unknown>;
  const id = field(record, "id", "wallet_id");
  const name = record["name"];
  if (typeof id !== "string" || typeof name !== "string") {
    throw new InvalidKeyDataError("OWS returned a wallet descriptor without an id or name");
  }
  const rawAccounts = Array.isArray(record["accounts"]) ? (record["accounts"] as unknown[]) : [];
  const accounts: OwsAccount[] = rawAccounts.map((entry) => {
    const account = (entry ?? {}) as Record<string, unknown>;
    return {
      chainId: String(field(account, "chainId", "chain_id") ?? ""),
      address: String(account["address"] ?? ""),
      derivationPath: String(field(account, "derivationPath", "derivation_path") ?? ""),
    };
  });
  const createdAt = field(record, "createdAt", "created_at");
  return {
    id,
    name,
    accounts,
    ...(typeof createdAt === "string" ? { createdAt } : {}),
  };
}

/**
 * Normalizes a signing result coming off an OWS access layer.
 *
 * @param value - The raw result reported by the access layer.
 * @returns The normalized {@link OwsSignResult}.
 * @throws {InvalidKeyDataError} If the payload carries no signature.
 */
export function toSignResult(value: unknown): OwsSignResult {
  if (typeof value === "string") return { signature: value };
  if (typeof value !== "object" || value === null) {
    throw new InvalidKeyDataError("OWS returned a malformed signing result");
  }
  const record = value as Record<string, unknown>;
  const signature = record["signature"];
  if (typeof signature !== "string") {
    throw new InvalidKeyDataError("OWS returned a signing result without a signature");
  }
  const recoveryId = field(record, "recoveryId", "recovery_id");
  return {
    signature,
    ...(typeof recoveryId === "number" ? { recoveryId } : {}),
  };
}
