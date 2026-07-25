import { Store } from "@tanstack/react-store";
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Key, KeyData, KeyId, KeyStoreAPI, KeyStoreState } from "@algorandfoundation/keystore";

/**
 * The reactive keystore state store. It is the single source of truth for the
 * key metadata surfaced in the UI. The `react-native-keystore` engine owns and
 * hydrates it behind the scenes (via its storage driver) during
 * `keystore.ready` — the app never mutates it directly. It also carries the
 * `algorithms` the engine has active, so the UI can display the available
 * cryptographic capabilities ("shims").
 */
export const keyStore = new Store<KeyStoreState>({
  keys: [],
  status: "idle",
  algorithms: [],
});

/**
 * Algorithm identifier for the post-quantum Falcon-1024 add-on, matching core's
 * `FALCON_ALGORITHM`. Used to check whether the keystore can create Falcon keys
 * before offering the action.
 */
export const FALCON_ALGORITHM = "Falcon-1024";

/**
 * The high-level keystore API surface these domain operations orchestrate. It is
 * the `key.store` object exposed by the provider (the shared `KeyStoreAPI` plus
 * the example's `clear`/`hooks` additions).
 */
export type KeyStore = KeyStoreAPI;

/** Result of {@link createWalletSeed}. */
export interface CreateWalletSeedResult {
  /** The persisted BIP39 seed key id. */
  seedId: KeyId;
  /** The XHD (BIP32-Ed25519) root key derived from the seed. */
  rootKeyId: KeyId;
  /** The freshly generated 24-word recovery phrase (shown once, never stored). */
  mnemonic: string;
}

/**
 * Creates a new wallet seed: generates a 24-word BIP39 mnemonic, imports its
 * seed bytes into the keystore, and derives an XHD (BIP32-Ed25519) root key from
 * it. The mnemonic is returned so the caller can present it to the user once —
 * it is never persisted.
 *
 * @param key - The keystore API (`provider.key.store`).
 * @returns The new `seedId`, its child `rootKeyId`, and the `mnemonic`.
 *
 * @example
 * ```typescript
 * const { seedId, rootKeyId, mnemonic } = await createWalletSeed(key.store);
 * ```
 */
export async function createWalletSeed(key: KeyStore): Promise<CreateWalletSeedResult> {
  const mnemonic = generateMnemonic(wordlist, 256);
  const seed = await mnemonicToSeed(mnemonic);
  const seedId = await key.importSeed!(seed, { name: "Wallet Seed" });
  const rootKeyId = await key.generate({
    type: "hd-root-key",
    algorithm: "raw",
    extractable: false,
    keyUsages: ["deriveBits", "deriveKey"],
    params: { parentKeyId: seedId },
  });
  return { seedId, rootKeyId, mnemonic };
}

/**
 * Generates a post-quantum Falcon-1024 keypair derived deterministically from an
 * existing seed, so it is color-grouped under the same seed as the rest of the
 * hierarchy. Requires the Falcon-1024 add-on to be active on the keystore (see
 * {@link KeyStoreState.algorithms}).
 *
 * @param key - The keystore API (`provider.key.store`).
 * @param seedId - The seed the Falcon key is derived from.
 * @returns The new Falcon key id.
 *
 * @example
 * ```typescript
 * const falconId = await generateFalconKey(key.store, selectedSeedId);
 * ```
 */
export async function generateFalconKey(key: KeyStore, seedId: KeyId): Promise<KeyId> {
  return key.generate({
    type: "falcon-1024",
    algorithm: FALCON_ALGORITHM,
    extractable: false,
    keyUsages: ["sign", "verify"],
    params: { parentKeyId: seedId },
  });
}

/** BIP44 coin type for Algorand accounts (SLIP-0044). */
const ALGORAND_COIN_TYPE = 283;

/**
 * Derives the next standard Algorand (BIP32-Ed25519) account key from an XHD
 * root key. The `index` should be the next free slot for account context 0 (see
 * {@link nextAccountIndex}).
 *
 * HD children are produced through the keystore's `deriveFromSeed` — which runs
 * the BIP32-Ed25519 shim over the unlocked root — rather than `generate`, which
 * only mints fresh (non-derived) keys. The account-context metadata
 * (`context: 0`) is preserved so the accounts extension keeps auto-populating an
 * on-chain account for each derived key.
 *
 * @param key - The keystore API (`provider.key.store`).
 * @param options - The parent `rootKeyId`, the derivation `index`, and an
 *   optional `account` number (defaults to `0`).
 * @returns The new derived key id.
 */
export async function deriveAccountKey(
  key: KeyStore,
  options: { rootKeyId: KeyId; index: number; account?: number },
): Promise<KeyId> {
  const account = options.account ?? 0;
  const path = `m/44'/${ALGORAND_COIN_TYPE}'/${account}'/0/${options.index}`;
  return key.deriveFromSeed!(options.rootKeyId, path, {
    algorithm: "EdDSA",
    metadata: { context: 0, account, index: options.index },
  });
}

/**
 * Computes the next free account-context (context 0) index for a given root key,
 * i.e. how many Ed25519 accounts already descend from it (each `deriveFromSeed`
 * child records its `parentKeyId`).
 *
 * @param keys - The current key list.
 * @param rootKeyId - The XHD root key to count children of.
 * @returns The next index to derive.
 */
export function nextAccountIndex(keys: Key[], rootKeyId: KeyId): number {
  return keys.filter(
    (k) => k.type === "hd-derived-ed25519" && k.metadata?.parentKeyId === rootKeyId,
  ).length;
}

/** Hex-encodes a byte array for human-readable display. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serializes exported {@link KeyData} to a pretty-printed JSON string, rendering
 * any `Uint8Array` material as hex so it is readable in an alert/detail view.
 *
 * @param keyData - The key data returned by `key.store.export(id)`.
 * @returns A pretty-printed, hex-encoded JSON string.
 */
export function formatKeyData(keyData: KeyData): string {
  return JSON.stringify(
    keyData,
    (_key, value) => (value instanceof Uint8Array ? bytesToHex(value) : value),
    2,
  );
}
