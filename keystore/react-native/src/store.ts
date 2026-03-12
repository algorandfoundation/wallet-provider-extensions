import {
	type Algorithm,
	clearKeyData,
	clearKeyStore,
	type DeriveOptions,
	generateKey as generateKeyStoreKey,
	InvalidKeyDataError,
	type KeyData,
	type KeyId,
	KeyNotFoundError,
	type KeyStoreState,
	type KeyType,
	removeKey as removeKeystoreKey,
	requiresParentKey,
	type SeedData,
	setStatus,
	type XHDDerivedKeyData,
	type XHDDomainP256KeyData,
	type XHDRootKey,
} from "@algorandfoundation/keystore";

import { generateId } from "@algorandfoundation/wallet-provider";
import {
	BIP32DerivationType,
	KeyContext,
} from "@algorandfoundation/xhd-wallet-api";

import {
	crypto_generichash,
	crypto_secretbox_open_easy,
} from "@algorandfoundation/xhd-wallet-api/dist/sumo.facade.js";
import type { Store } from "@tanstack/store";
import type {
	BufferLike,
	CryptoKey,
	EncryptDecryptParams,
	SubtleAlgorithm,
} from "react-native-quick-crypto";
import { xhd } from "./libs.ts";
import { commit, fetchSecret, storage } from "./storage/state.ts";

export * from "./import.ts";

/**
 * Type guard for SeedData
 */
function isSeedData(key: any): key is SeedData {
	return key?.type === "hd-seed";
}

/**
 * Type guard for XHDRootKey
 */
function isXHDRootKey(key: any): key is XHDRootKey {
	return key?.type === "hd-root-key";
}

/**
 * Removes a key from the reactive store and persistent storage.
 * @param params - The removal parameters
 * @param params.store - The reactive store instance
 * @param params.keyId - The ID of the key to remove
 */
export async function removeKey({
	store,
	keyId,
}: {
	store: Store<KeyStoreState>;
	keyId: string;
}): Promise<void> {
	// Remove the key from storage
	storage.remove(keyId);
	removeKeystoreKey({ store, keyId });
}

/**
 * Clears all keys from the reactive store and persistent storage.
 * @param params - The clear parameters
 * @param params.store - The reactive store instance
 */
export async function clear({
	store,
}: {
	store: Store<KeyStoreState>;
}): Promise<void> {
	clearKeyStore({ store });
	storage.clearAll();
}

/**
 * Generates a new key pair, stores it, and updates the reactive store.
 * Supports various algorithm types via options.
 * @param options - The generation parameters
 * @param options.store - The reactive store instance
 * @param options.algorithm - The algorithm to use for generation
 * @param options.extractable - Whether the private key can be exported
 * @param options.keyUsages - Intended usages for the key
 * @returns The generated KeyId
 */
export async function generateKey(options: {
	store: Store<KeyStoreState>;
	type: KeyType;
	algorithm: Algorithm;
	extractable: boolean;
	keyUsages: KeyUsage[];
	params?: Record<string, any>;
}): Promise<KeyId> {
	const {
		store,
		algorithm,
		type,
		params,
		extractable = false,
		keyUsages = ["sign"],
	} = options;
	// Signal that we are generating a key
	setStatus({ store, status: "generating" });

	let parentKey: XHDRootKey | SeedData | null = null;
	let keyData: KeyData | null = null;
	const parentRequired = requiresParentKey({ type });
	try {
		if (parentRequired && typeof params?.parentKeyId === "undefined") {
			throw new InvalidKeyDataError(
				`XHD derived keys require a rootKeyId, please upload it first using importSeed()`,
			);
		}
		parentKey = parentRequired
			? await fetchSecret<SeedData>({ keyId: params?.parentKeyId })
			: null;
		if (parentRequired && !parentKey) {
			throw new KeyNotFoundError(params?.parentKeyId);
		}

		// Ensure the parentKey has the correct type for the core library
		// If it's a seed, it must be "hd-seed" and have format "raw"
		// (We already ensure this in importSeed/importKey)

		// Map our internal types to keystore types if needed
		const mappedType = type === "ed25519" ? "ecc" : type;

		// If we are generating a P256 key, we need the root key
		if (
			mappedType === "hd-derived-p256" ||
			mappedType === "ecc" ||
			algorithm === "P256"
		) {
			let rootKey: XHDRootKey | null = null;
			if (isSeedData(parentKey)) {
				// Generate a temporary root key from the seed
				const rootKeyData = (await generateKeyStoreKey({
					keyData: {
						type: "hd-root-key",
						algorithm: "raw",
						format: "raw",
						metadata: { parentKeyId: parentKey.id },
					} as any,
					parentKey: {
						...parentKey,
						type: "hd-seed",
						format: "raw",
					} as any,
				})) as XHDRootKey;
				rootKey = rootKeyData;
			} else if (isXHDRootKey(parentKey)) {
				rootKey = parentKey;
			}

			if (!rootKey) {
				throw new InvalidKeyDataError(
					`XHD derived keys require a rootKeyId, please upload it first using importSeed()`,
				);
			}

			const derivedKeyData = await generateKeyStoreKey({
				keyData: {
					id: generateId(),
					type: "hd-derived-p256",
					algorithm: "P256",
					extractable,
					keyUsages: keyUsages,
					metadata: {
						...params,
						createdAt: new Date(),
						parentKeyId: rootKey.id,
					},
				} as any,
				parentKey: {
					...rootKey,
					type: "hd-root-key",
					privateKey: rootKey.privateKey,
				} as any,
			});
			await commit({ store, keyData: derivedKeyData });
			if (parentKey && isSeedData(parentKey)) clearKeyData(rootKey);
			return derivedKeyData.id;
		}

		// For root key generation, the parent MUST be an hd-seed with format raw
		// AND it must have the seed in privateKey.
		const finalParentKey = parentKey
			? {
					...parentKey,
					type:
						isSeedData(parentKey) || mappedType === "hd-root-key"
							? "hd-seed"
							: (parentKey as any).type,
					format:
						isSeedData(parentKey) || mappedType === "hd-root-key"
							? "raw"
							: (parentKey as any).format,
					privateKey: parentKey.privateKey,
					seed: parentKey.privateKey,
					key: parentKey.privateKey,
					extractable: true, // Some libraries might check this
				}
			: null;
		keyData = await generateKeyStoreKey({
			keyData: {
				id: generateId(),
				type: mappedType,
				algorithm,
				extractable,
				keyUsages: keyUsages,
				metadata: {
					...params,
					createdAt: new Date(),
				},
			} as any,
			parentKey: finalParentKey as any,
		});

		// Persist the key to storage
		await commit({ store, keyData });

		// Return the generated key ID
		return keyData.id;
	} finally {
		clearKeyData(keyData);
		clearKeyData(parentKey);
		setStatus({ store, status: "idle" });
	}
}

export function parsePath(path: string): number[] {
	return path
		.replace(/^m\/?/, "")
		.split("/")
		.map((part) => {
			const hardened = part.endsWith("'") || part.endsWith("h");
			const index = parseInt(part.replace(/['h]$/, ""), 10);
			return hardened ? index + 0x80000000 : index;
		});
}

/**
 * Derives a new key from an existing seed in the keystore.
 * @param params - The derivation parameters
 * @param params.store - The reactive store instance
 * @param params.seedId - The ID of the seed to derive from
 * @param params.path - The derivation path
 * @param params.options - Optional derivation settings
 * @returns The ID of the derived key
 * @todo: Move to keystore
 */
export async function deriveFromSeed({
	store,
	seedId,
	path,
	options,
}: {
	store: Store<KeyStoreState>;
	seedId: KeyId;
	path: string;
	options?: DeriveOptions;
}): Promise<KeyId> {
	setStatus({ store, status: "deriving" });

	let rootKey: XHDRootKey | SeedData | null = null;
	let derivedKey: KeyData | XHDDerivedKeyData | XHDDomainP256KeyData | null =
		null;
	try {
		const secret = await fetchSecret<KeyData>({ keyId: seedId });
		if (!secret) throw new KeyNotFoundError(seedId);
		if (!isXHDRootKey(secret) && !isSeedData(secret))
			throw new InvalidKeyDataError("Not a root key");

		rootKey = secret;

		if (typeof rootKey.privateKey === "undefined") {
			throw new InvalidKeyDataError("Could find root key material");
		}
		const isP256 =
			options?.curve === "secp256r1" || options?.algorithm === "P256";

		if (isP256) {
			const seedId = isSeedData(rootKey)
				? rootKey.id
				: (rootKey as any).metadata?.parentKeyId;
			const seedKey =
				seedId === rootKey.id
					? rootKey
					: await fetchSecret<SeedData>({ keyId: seedId as string });

			derivedKey = (await generateKeyStoreKey({
				keyData: {
					id: generateId(),
					type: "hd-derived-p256",
					algorithm: options?.algorithm ?? "P256",
					format: "raw",
					metadata: {
						origin: options?.origin ?? "default",
						userHandle: options?.userHandle ?? "default",
						counter: options?.counter ?? 0,
						parentKeyId: seedId,
					} as any,
				} as any,
				parentKey: {
					...seedKey,
					type: "hd-seed",
					format: "raw",
					seed: seedKey?.privateKey,
					privateKey: seedKey?.privateKey,
				} as any,
			})) as XHDDomainP256KeyData;

			await commit({ store, keyData: derivedKey });
			if (seedKey && seedKey !== rootKey) clearKeyData(seedKey);

			return derivedKey.id;
		} else {
			const derivationPath = parsePath(path);
			const derivationType =
				options?.mode === "standard"
					? BIP32DerivationType.Khovratovich
					: BIP32DerivationType.Peikert;

			const context =
				derivationPath[1] === 0x8000011b
					? KeyContext.Address
					: KeyContext.Identity;
			const account = (derivationPath[2] ?? 0x80000000) & 0x7fffffff;
			const keyIndex = (derivationPath[4] ?? 0) & 0x7fffffff;

			const derivedPublic = await xhd.keyGen(
				rootKey.privateKey,
				context,
				account,
				keyIndex,
				derivationType,
			);

			const id = options?.id ?? generateId();
			const keyData: KeyData = {
				id,
				type: "hd-derived-ed25519",
				algorithm: "EdDSA",
				extractable: false,
				publicKey: derivedPublic,
				metadata: {
					...options?.metadata,
					derivationPath: path,
					parentKeyId: rootKey.id, // Point to root key, not seed
					context,
					account,
					keyIndex,
					// Store root key info to satisfy signWithKeyData requirements
					rootKey: {
						...rootKey,
						type: "hd-root-key",
						privateKey: rootKey.privateKey,
					},
				},
			} as any;

			await commit({ store, keyData });
			return id;
		}
	} finally {
		clearKeyData(rootKey);
		clearKeyData(derivedKey);
		setStatus({ store, status: "idle" });
	}
}

export async function exportKey({
	store,
	id,
}: {
	store: Store<KeyStoreState>;
	id: string;
	options?: any;
}): Promise<KeyData> {
	setStatus({ store, status: "exporting" });
	try {
		const key = await fetchSecret<KeyData>({ keyId: id });
		if (!key) throw new KeyNotFoundError(id);
		if (!key.extractable) {
			throw new InvalidKeyDataError("Cannot export an non-extractable key");
		}
		return key;
	} finally {
		setStatus({ store, status: "idle" });
	}
}

export async function decryptWithKey({
	store,
	id,
	data,
}: {
	store: Store<KeyStoreState>;
	id: KeyId;
	data: Uint8Array;
	algorithm?: string;
}): Promise<Uint8Array> {
	store.setState((s) => ({ ...s, status: "decrypting" }));
	let key: KeyData | null = null;

	try {
		key = await fetchSecret<KeyData>({ keyId: id });
		if (!key) throw new KeyNotFoundError(id);

		if (typeof key.publicKey === "undefined")
			throw new InvalidKeyDataError("Key must have a public key");

		const symmetricKey = crypto_generichash(32, key.publicKey);
		const nonce = data.slice(0, 24);
		const ciphertext = data.slice(24);

		const decrypted = crypto_secretbox_open_easy(
			ciphertext,
			nonce,
			symmetricKey,
		);
		if (!decrypted) throw new Error("Decryption failed");

		store.setState((s) => ({ ...s, status: "idle" }));
		return decrypted;
	} finally {
		clearKeyData(key);
	}
}

export async function wrapKey(_options: {
	store: Store<KeyStoreState>;
	format: any;
	key: CryptoKey;
	wrappingKey: CryptoKey;
	wrapAlgorithm: EncryptDecryptParams;
}): Promise<ArrayBuffer> {
	throw new Error("Method not implemented.");
}

export async function unwrapKey(_options: {
	store: Store<KeyStoreState>;
	format: any;
	wrappedKey: BufferLike;
	unwrappingKey: CryptoKey;
	unwrapAlgorithm: EncryptDecryptParams;
	unwrappedKeyAlgorithm: SubtleAlgorithm;
	extractable: boolean;
	keyUsages: KeyUsage[];
}): Promise<CryptoKey> {
	throw new Error("Method not implemented.");
}
