import {
  clearKeyData,
  InvalidKeyDataError,
  type KeyData,
  type KeyId,
  type KeyStoreState,
  setStatus,
} from "@algorandfoundation/keystore";
import { clearBuffer } from "@algorandfoundation/wallet-provider";
import { base64url } from "@scure/base";
import type { Store } from "@tanstack/store";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { MasterKeyNotFoundError } from "../errors.ts";
import type { AuthenticationOptions } from "../types.ts";
import { createMasterKey, decryptData, encryptData, readMasterKey } from "./crypto.ts";

export const storage: MMKV = createMMKV({
  id: "keystore",
  mode: "multi-process",
});

async function readOrCreateMasterKeyForEmptyStorage(options?: AuthenticationOptions) {
  try {
    return await readMasterKey(options);
  } catch (error) {
    if (!(error instanceof MasterKeyNotFoundError)) throw error;
    if (storage.getAllKeys().length > 0) throw error;
    return createMasterKey(options);
  }
}

/**
 * Fetches a secret from persistent storage and decrypts it using the master key.
 * @param params - The fetch parameters.
 * @param params.keyId - The ID of the key to fetch
 * @param params.options - Options to override the biometrics and masterkey
 * @returns The decrypted secret data or null if not found
 */
export async function fetchSecret<T>({
  keyId,
  options,
}: {
  keyId: KeyId;
  options?: AuthenticationOptions & { masterKey?: Buffer };
}): Promise<T | null> {
  let key = options?.masterKey;
  let isInternalKey = false;
  try {
    const encryptedData = storage.getString(keyId);
    if (!encryptedData) return null;
    if (!key) {
      key = await readMasterKey(options);
      isInternalKey = true;
    }
    return decode(decryptData(key, encryptedData)) as T;
  } finally {
    if (isInternalKey && key) {
      clearBuffer(key);
    }
  }
}

/**
 * Removes a secret from persistent storage.
 * @param params - The removal parameters.
 * @param params.keyId - The ID of the key to remove
 */
export async function removeSecret({ keyId }: { keyId: KeyId }): Promise<void> {
  storage.remove(keyId);
}

/**
 * Commits a key to persistent storage and updates the reactive store.
 * The private key is encrypted before storage and cleared from memory.
 * @param params - The commit parameters.
 * @param params.store - The reactive store instance
 * @param params.keyData - The key data to store
 */
export async function commit({
  store,
  keyData,
  options,
}: {
  store: Store<KeyStoreState>;
  keyData: KeyData;
  options?: AuthenticationOptions;
}): Promise<void> {
  if (typeof keyData.id === "undefined")
    throw new InvalidKeyDataError(
      "KeyData must have an ID before committing to storage. Please use generateKey() to generate a new key.",
    );
  setStatus({ store, status: "commiting" });

  try {
    // Never allow the master key to touch memory.
    storage.set(
      keyData.id,
      encryptData(await readOrCreateMasterKeyForEmptyStorage(options), encode(keyData)),
    );
    // remove the private keys from keyData
    const { privateKey, seed, ...keyState } = keyData as any;
    // clear then delete the keys from the keyData object to remove it from memory, even from the caller 😈
    clearBuffer(privateKey);
    clearBuffer(seed);
    delete (keyData as any).privateKey;
    delete (keyData as any).seed;

    // Reflect the change in the reactive store
    store.setState((state) => ({
      ...state,
      keys: [{ ...keyState }, ...state.keys],
    }));
  } finally {
    clearKeyData(keyData);
    setStatus({ store, status: "idle" });
  }
}

export function encode(key: KeyData): string {
  const encoder = new TextEncoder();
  return base64url.encode(
    encoder.encode(
      JSON.stringify(key, (_key, value) => {
        if (
          value instanceof Uint8Array ||
          (value?.constructor && value.constructor.name === "Uint8Array")
        ) {
          return Array.from(value);
        }
        return value;
      }),
    ),
  );
}
export function decode(data: string): KeyData {
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(base64url.decode(data)), (key, value) => {
    if (
      (key.endsWith("Key") ||
        key === "privateKey" ||
        key === "publicKey" ||
        key === "seed" ||
        key === "key") &&
      Array.isArray(value)
    ) {
      return new Uint8Array(value);
    }
    return value;
  });
}
