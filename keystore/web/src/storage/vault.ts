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

/** Prefix of the Web Lock serialising master-key creation, one per database. */
const MASTER_KEY_LOCK_PREFIX = "keystore.master-key-init:";

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
 * Creation is serialised with a Web Lock where the API is available, so
 * callers racing from other same-origin contexts converge on one key instead
 * of each keeping the one it minted.
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
  // Creation races across contexts. Every same-origin context that builds a
  // driver — a service worker, an offscreen document, each extension page —
  // reaches this concurrently on first use: all of them miss the read above,
  // all generate, the last `put` wins, and each one goes on using the key it
  // generated itself. Material sealed by one context then cannot be opened by
  // another, surfacing as a bare AES-GCM `OperationError`. Web Locks are held
  // across every same-origin context, workers included, so the first caller
  // creates and the rest re-read what it wrote. Where the API is not exposed —
  // a non-browser host, or an insecure context, `LockManager` being
  // `[SecureContext]` — the re-read narrows the window but cannot close it.
  const create = async (): Promise<CryptoKey> => {
    const raced = await db.get<MaterialRecord>(MATERIAL_STORE, MASTER_KEY_ID);
    if (raced && raced.kind === "cryptokey") {
      return raced.privateKey;
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
  };
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(`${MASTER_KEY_LOCK_PREFIX}${db.name}`, create) : create();
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
