/**
 * Encryption-at-rest for material that cannot be persisted as a
 * {@link CryptoKey} (shim key material and raw seeds).
 *
 * The vault owns a single AES-GCM **master key** that is itself a
 * non-extractable {@link CryptoKey} persisted in IndexedDB (structured-cloned,
 * so its bytes never live in JS). All byte-material is sealed with it before it
 * is written and only ever opened just-in-time for a single operation.
 */

import type { KeyStoreDatabase } from "./db.ts";
import { MATERIAL_STORE, type MaterialRecord } from "./db.ts";

/** Reserved material id under which the vault master key is persisted. */
export const MASTER_KEY_ID = "__keystore.master__";

/** AES-GCM IV length in bytes (96-bit, the recommended GCM nonce size). */
const IV_LENGTH = 12;

/** Casts a `Uint8Array` to the strict `BufferSource` overload WebCrypto expects. */
function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * A sealed payload: AES-GCM ciphertext together with the IV used to produce it.
 */
export interface SealedBytes {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Loads the vault master key from storage, creating and persisting a fresh
 * non-extractable AES-GCM key on first use.
 *
 * @param db - The keystore database handle.
 * @param subtle - The host {@link SubtleCrypto} (never a shim decorator — this
 *   is a standard AES-GCM key).
 * @returns The master {@link CryptoKey}.
 */
export async function getMasterKey(db: KeyStoreDatabase, subtle: SubtleCrypto): Promise<CryptoKey> {
  const existing = await db.get<MaterialRecord>(MATERIAL_STORE, MASTER_KEY_ID);
  if (existing && existing.kind === "cryptokey") {
    return existing.privateKey;
  }
  const master = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await db.put<MaterialRecord>(MATERIAL_STORE, {
    id: MASTER_KEY_ID,
    kind: "cryptokey",
    privateKey: master,
  });
  return master;
}

/**
 * Seals plaintext bytes with the master key (AES-GCM).
 *
 * @param subtle - The host {@link SubtleCrypto}.
 * @param master - The vault master key.
 * @param plaintext - The bytes to encrypt.
 * @returns The {@link SealedBytes} to persist.
 */
export async function seal(
  subtle: SubtleCrypto,
  master: CryptoKey,
  plaintext: Uint8Array,
): Promise<SealedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, master, bs(plaintext));
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Opens sealed bytes with the master key (AES-GCM).
 *
 * @param subtle - The host {@link SubtleCrypto}.
 * @param master - The vault master key.
 * @param sealed - The {@link SealedBytes} previously produced by {@link seal}.
 * @returns The decrypted plaintext. The caller owns this buffer and should wipe
 *   or hand it straight to a shim (which wipes injected material after use).
 */
export async function open(
  subtle: SubtleCrypto,
  master: CryptoKey,
  sealed: SealedBytes,
): Promise<Uint8Array> {
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: bs(sealed.iv) },
    master,
    bs(sealed.ciphertext),
  );
  return new Uint8Array(plaintext);
}
