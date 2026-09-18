/**
 * Bridges the wallet keystore to the `react-native-passkey-autofill`
 * credential provider.
 *
 * Registering the provider service (app.json config plugin) is not enough:
 * the service refuses to surface ANY passkey entries (for `get` *and*
 * `create` requests alike) until the wallet has shared its keystore
 * **master key** (`setMasterKey`, so the service can unseal records in the
 * shared `keystore` MMKV) and pointed the passkey hierarchy at a **main
 * key** (`setMainKeyId`, the deterministic-P256 root domain passkeys are
 * derived from). Without this hand-off, Android's Credential Manager shows
 * "No passkeys available" even when the wallet is the enabled provider.
 *
 * The sync runs automatically after a wallet seed is created (Keystore
 * screen) and on demand from the Passkeys screen.
 */
import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";
import { readMasterKey } from "@algorandfoundation/keystore";
import type { Key, KeyId } from "@algorandfoundation/keystore";

import { keyStore, type KeyStore } from "@/stores/keystore";

/**
 * Finds the deterministic-P256 passkey main key: it shares the
 * `hd-root-key` type with the XHD (BIP32-Ed25519) root but is
 * distinguished by `metadata.scheme === "pbkdf2-p256"`.
 */
export function findPasskeyMainKey(keys: Key[]): Key | undefined {
  return keys.find((k) => k.type === "hd-root-key" && k.metadata?.scheme === "pbkdf2-p256");
}

/**
 * Returns the id of the passkey main key, deriving one from the wallet
 * seed when it does not exist yet. Throws when the wallet has no seed:
 * the main key is deterministic, so it must descend from the recovery
 * phrase to survive a restore.
 */
export async function ensurePasskeyMainKey(key: KeyStore): Promise<KeyId> {
  const existing = findPasskeyMainKey(keyStore.state.keys);
  if (existing) return existing.id;

  const seed = keyStore.state.keys.find((k) => k.type === "seed" || k.type === "hd-seed");
  if (!seed) {
    throw new Error("Create a wallet seed first — the passkey main key is derived from it.");
  }

  // `algorithm: "P256"` selects the deterministic-P256 main-key path of the
  // keystore's `generate` (vs. the XHD root that shares the type).
  return key.generate({
    type: "hd-root-key",
    algorithm: "P256",
    extractable: false,
    keyUsages: ["deriveBits", "deriveKey"],
    params: { parentKeyId: seed.id, name: "Passkey Main Key" },
  });
}

/**
 * Whether the credential provider is already pointed at this wallet's
 * passkey main key. (The master key cannot be probed from JS; it is set
 * together with the main key by {@link syncPasskeyProviderKeys}, so the
 * main-key pointer is the sync marker.)
 */
export async function isPasskeyProviderSynced(): Promise<boolean> {
  const mainKey = findPasskeyMainKey(keyStore.state.keys);
  if (!mainKey) return false;
  const current = await PasskeyAutofill.getMainKeyId();
  return current === mainKey.id;
}

/**
 * Shares the wallet keys with the credential provider service: ensures the
 * deterministic-P256 main key exists, hands the keystore master key to the
 * native side (raw bytes, zeroed after the call), and points the passkey
 * hierarchy at the main key. Idempotent: skips the biometric-gated
 * master-key read when the provider already points at the current main key
 * (pass `force` to re-share anyway).
 */
export async function syncPasskeyProviderKeys(
  key: KeyStore,
  options?: { force?: boolean },
): Promise<"synced" | "already-synced"> {
  const mainKeyId = await ensurePasskeyMainKey(key);
  if (!options?.force && (await PasskeyAutofill.getMainKeyId()) === mainKeyId) {
    return "already-synced";
  }

  // The provider stores its own copy sealed under an AndroidKeyStore AES
  // key; pass the raw bytes (never a hex string) and zero them right after.
  const masterKey = await readMasterKey({
    prompt: {
      title: "Set up passkey provider",
      description: "Share the wallet keys with this device's credential provider.",
    },
  });
  try {
    await PasskeyAutofill.setMasterKey(Uint8Array.from(masterKey));
  } finally {
    masterKey.fill(0);
  }
  await PasskeyAutofill.setMainKeyId(mainKeyId);
  return "synced";
}
