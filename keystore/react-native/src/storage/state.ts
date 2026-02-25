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
import { decryptData, encryptData, getMasterKey } from "./crypto.ts";

export const storage: MMKV = createMMKV({
	id: "keystore",
});

/**
 * Fetches a secret from persistent storage and decrypts it using the master key.
 * @param params - The fetch parameters.
 * @param params.keyId - The ID of the key to fetch
 * @param params.masterKey - Optional master key override
 * @returns The decrypted secret data or null if not found
 */
export async function fetchSecret<T>({
	keyId,
	masterKey,
}: {
	keyId: KeyId;
	masterKey?: Buffer;
}): Promise<T | null> {
	try {
		const encryptedSeed = storage.getString(keyId);
		if (!encryptedSeed) return null;
		return decode(
			decryptData(masterKey ? masterKey : await getMasterKey(), encryptedSeed),
		) as T;
	} finally {
		clearBuffer(masterKey);
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
}: {
	store: Store<KeyStoreState>;
	keyData: KeyData;
}): Promise<void> {
	if (typeof keyData.id === "undefined")
		throw new InvalidKeyDataError(
			"KeyData must have an ID before committing to storage. Please use generateKey() to generate a new key.",
		);
	setStatus({ store, status: "commiting" });

	try {
		// Never allow the master key to touch memory.
		storage.set(keyData.id, encryptData(await getMasterKey(), encode(keyData)));

		// remove the private keys from keyData
		const { privateKey, ...keyState } = keyData;
		// clear then delete the private key from the keyData object to remove it from memory
		clearBuffer(privateKey);
		delete keyData.privateKey;

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
				if (value instanceof Uint8Array) {
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
		if (key.endsWith("Key") && Array.isArray(value)) {
			return new Uint8Array(value);
		}
		return value;
	});
}
