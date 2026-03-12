import { seedFromMnemonic } from "@algorandfoundation/algokit-utils/algo25";
import { DeterministicP256 } from "@algorandfoundation/dp256";
import {
	type Algorithm,
	clearKeyData,
	InvalidKeyDataError,
	InvalidKeyFormatError,
	type KeyData,
	type KeyId,
	KeyNotFoundError,
	type KeyStoreState,
	type SeedData,
	type KeyType,
	type KeyFormat,
	setStatus,
	type XHDDomainP256KeyData,
	type XHDRootKey,
} from "@algorandfoundation/keystore";
import { clearBuffer, generateId } from "@algorandfoundation/wallet-provider";
import {
	BIP32DerivationType,
	KeyContext,
	fromSeed,
} from "@algorandfoundation/xhd-wallet-api";
import { Buffer } from "buffer";
import { base64url } from "@scure/base";
import * as bip39 from "@scure/bip39";
import { wordlist as englishWordList } from "@scure/bip39/wordlists/english.js";
import {
	subtle,
} from "react-native-quick-crypto";
import type { Store } from "@tanstack/store";

import { DecodingError } from "./errors.ts";
import { xhd } from "./libs.ts";
import { commit, fetchSecret } from "./storage/state.ts";

const dp256 = new DeterministicP256();

/**
 * Imports a cryptographic seed into the key store for further usage.
 *
 * @param {Object} options - The options object containing parameters for the seed import.
 * @param {Store<KeyStoreState>} options.store - The key store instance for managing cryptographic keys.
 * @param {Uint8Array | string | { words: string[], passphrase?: string; entropy: Uint8Array }} options.seed - The seed data, either as a byte array, a mnemonic string, or an entropy object.
 * @param {string} [options.name] - Optional name to assign to the imported seed.
 * @param {"raw" | "bip39" | "algo25"} [options.algorithm="raw"] - The algorithm to use for the seed.
 * @param {"bytes" | "base64" | "string"} [options.format="bytes"] - The format of the seed input.
 * @param {boolean} [options.extractable=false] - Indicates whether the key material is exportable (defaults to false).
 * @param {KeyUsage[]} [options.keyUsages=["deriveKey", "deriveBits"]] - Specifies the key usages allowed (defaults to deriving keys and bits).
 * @return {Promise<KeyId>} A promise resolving to the unique identifier of the imported seed.
 */
export async function importSeed({
	store,
	seed,
	name,
	id: providedId,
	type = "hd-seed",
	algorithm = "raw",
	format = "bytes",
	extractable = false,
	keyUsages = ["deriveKey", "deriveBits"],
	metadata: providedMetadata = {},
}: {
	store: Store<KeyStoreState>;
	seed:
		| Uint8Array
		| string
		| { words?: string[]; passphrase?: string; entropy: Uint8Array };
	algorithm?: "raw" | "bip39" | "algo25";
	format?: "bytes" | "base64" | "string";
	extractable?: boolean;
	keyUsages?: KeyUsage[];
	name?: string;
	id?: KeyId;
	type?: KeyType;
	metadata?: Record<string, any>;
}): Promise<KeyId> {
	setStatus({ store, status: "importing" });
	const id = providedId || generateId();

	let privateKey: Uint8Array;
	const metadata = { ...providedMetadata };

	try {
		if (algorithm === "raw") {
			if (seed.constructor === String) {
				privateKey = base64url.decode(seed as string);
				if (format !== "base64") {
					privateKey = new TextEncoder().encode(seed as string);
				}
			} else if (seed instanceof Uint8Array) {
				privateKey = seed;
			} else {
				throw new InvalidKeyDataError(
					"Raw algorithm requires string or Uint8Array seed",
				);
			}
		} else if (algorithm === "bip39") {
			if (typeof seed === "string") {
				privateKey = bip39.mnemonicToSeedSync(seed);
			} else if (seed instanceof Uint8Array) {
				const mnemonic = new TextDecoder().decode(seed);
				privateKey = bip39.mnemonicToSeedSync(mnemonic);
			} else if (typeof seed === "object" && "entropy" in seed) {
				privateKey = bip39.mnemonicToSeedSync(
					bip39.entropyToMnemonic(seed.entropy, englishWordList),
					seed.passphrase,
				);
			} else {
				throw new InvalidKeyDataError(
					"BIP39 requires a mnemonic string, bytes or entropy object",
				);
			}
		} else if (algorithm === "algo25") {
			if (typeof seed === "string") {
				// Algorand mnemonics are 25 words.
				try {
					privateKey = seedFromMnemonic(seed);
				} catch (e) {
					throw new InvalidKeyDataError(
						`Invalid Algo25 mnemonic: ${e instanceof Error ? e.message : String(e)}`,
					);
				}
			} else if (seed instanceof Uint8Array) {
				privateKey = seed;
			} else {
				throw new InvalidKeyDataError(
					"Algo25 requires a mnemonic string or Uint8Array seed",
				);
			}
		} else {
			throw new InvalidKeyDataError(`Unsupported algorithm: ${algorithm}`);
		}

		await commit({
			store,
			keyData: {
				id,
				type,
				name: name || "Imported Seed",
				algorithm,
				format,
				extractable,
				keyUsages,
				privateKey:
					type === "hd-root-key" && privateKey.length !== 96
						? fromSeed(Buffer.from(privateKey))
						: privateKey,
				metadata,
			} as SeedData,
		});
	} finally {
		setStatus({ store, status: "idle" });
	}

	return id;
}

export async function importEd25519Key({
	store,
	keyData,
	seed,
	type = "ed25519",
	format,
	extractable,
	keyUsages,
	id: providedId,
}: {
	store: Store<KeyStoreState>;
	keyData: Omit<KeyData, "id"> | Uint8Array | string;
	seed?: SeedData;
	format?: KeyFormat;
	extractable?: boolean;
	keyUsages?: KeyUsage[];
	id?: KeyId;
	type?: KeyType;
}): Promise<KeyId> {
	setStatus({ store, status: "importing" });
	const id = providedId || generateId();
	try {
		if (keyData instanceof Uint8Array || typeof keyData === "string") {

			let privateKey: Uint8Array;
			let publicKey: Uint8Array;

			if (typeof keyData === "string") {
				if (format === "base64") {
					privateKey = base64url.decode(keyData);
				} else if (format === "bip39") {
					privateKey = bip39.mnemonicToSeedSync(keyData);
				} else if (format === "algo25") {
					privateKey = seedFromMnemonic(keyData);
				} else {
					privateKey = new TextEncoder().encode(keyData);
				}
			} else {
				if (
					format &&
					format !== "raw" &&
					format !== "keydata" &&
					format !== "seed"
				) {
					throw new InvalidKeyDataError(
						"If format is specified for Uint8Array, it must be 'raw', 'bytes' or 'seed'",
					);
				}
				privateKey = keyData;
			}

			if (privateKey.length === 64 && typeof keyData !== "string") {
				publicKey = privateKey.slice(32);
			} else {
				if (privateKey.length !== 32 && privateKey.length !== 64) {
					// BIP39 seed can be 64 bytes
					if (format !== "bip39" || privateKey.length < 32) {
						throw new InvalidKeyDataError(
							`Ed25519 seed must be 32 or 64 bytes, got ${privateKey.length}`,
						);
					}
				}

				// For Algorand, a standard Ed25519 key is often 64 bytes: [seed || public_key]
				// If it's a BIP39 seed (64 bytes), we should probably use the first 32 bytes or follow BIP32-Ed25519
				const actualSeed =
					privateKey.length === 64 ? privateKey.slice(0, 32) : privateKey;

				const key = await subtle.importKey(
					"raw",
					actualSeed,
					{ name: "Ed25519" },
					true,
					["sign", "verify"],
				);
				const rawPublicKey = (await subtle.exportKey(
					"raw",
					key,
				)) as Uint8Array;
				publicKey = rawPublicKey;

				const combinedKey = new Uint8Array(64);
				combinedKey.set(actualSeed);
				combinedKey.set(publicKey, 32);
				privateKey = combinedKey;
			}

			await commit({
				store,
				keyData: {
					id,
					type,
					algorithm: "EdDSA",
					extractable: extractable ?? false,
					keyUsages: keyUsages ?? ["sign"],
					privateKey,
					publicKey,
					metadata: {
						name: "Imported Ed25519 Key",
						parentKeyId: seed?.id,
					},
				} as KeyData,
			});
			return id;
		}



		if (typeof keyData === "object" && "publicKey" in keyData && keyData.publicKey) {
			const finalId = (keyData as any).id || id;
			await commit({
				store,
				keyData: {
					...keyData,
					id: finalId,
					type: type || "ed25519",
					metadata: {
						...keyData.metadata,
						rootKeyId: keyData.metadata?.rootKeyId ?? undefined,
					},
				} as KeyData,
			});
			return finalId;
		}

		if (typeof seed?.privateKey === "undefined") {
			throw new InvalidKeyDataError("XHD derived keys require a seed");
		}

		if (type === "hd-derived-ed25519" && !keyData.publicKey) {
			const derivedPublic = await xhd.keyGen(
				seed.privateKey,
				(keyData.metadata?.context as any) ?? KeyContext.Address,
				(keyData.metadata?.account as any) ?? 0,
				(keyData.metadata?.index as any) ?? 0,
				BIP32DerivationType.Peikert,
			);
			keyData.publicKey = derivedPublic;
		}

		await commit({
			store,
			keyData: {
				...keyData,
				type: type || "ed25519",
				metadata: {
					...keyData.metadata,
					rootKeyId: keyData.metadata?.rootKeyId ?? undefined,
					parentKeyId: seed.id,
				},
				id,
			} as KeyData,
		});
		return id;
	} finally {
		if (typeof keyData === "object") {
			clearKeyData(keyData as KeyData);
		}
		if (seed) {
			clearKeyData(seed);
		}
		setStatus({ store, status: "idle" });
	}
}

export async function importPasskey({
	store,
	keyData,
}: {
	store: Store<KeyStoreState>;
	keyData: Omit<XHDDomainP256KeyData, "id">;
}): Promise<KeyId> {
	if (keyData.algorithm !== "P256") {
		throw new InvalidKeyDataError(
			"Only P-256 derived keys are currently supported",
		);
	}
	if (keyData.metadata && keyData.metadata.parentKeyId === undefined) {
		throw new InvalidKeyDataError(
			"XHD derived keys require a rootKeyId, please upload it first using importSeed()",
		);
	}

	setStatus({ store, status: "importing" });

	const key = {
		id: generateId(),
		...keyData,
		metadata: {
			...keyData.metadata,
		},
	};

	try {
		// Get the seed from the root key ID
		const openKey = await fetchSecret<XHDRootKey>({
			keyId: keyData.metadata.parentKeyId,
		});
		if (!openKey) throw new KeyNotFoundError(keyData.metadata.parentKeyId);
		// Check for the correct type
		if (openKey.privateKey === undefined) {
			throw new DecodingError("Could not decrypt root key");
		}
		if (openKey.type !== "hd-root-key") {
			// Clear the buffers
			clearBuffer(openKey.privateKey);
			delete openKey.privateKey;

			throw new InvalidKeyDataError("Root key is not a seed key");
		}

		const keyPair = await dp256.genDomainSpecificKeyPair(
			openKey.privateKey,
			keyData.metadata.origin,
			keyData.metadata.userHandle,
			keyData.metadata.counter,
		);
		key.publicKey = dp256.getPurePKBytes(keyPair);
		await commit({
			store,
			keyData: {
				...key,
				privateKey: keyPair,
			},
		});

		// Cleanup the buffers
		clearBuffer(openKey.privateKey);
		delete openKey.privateKey;
		clearBuffer(keyPair);

		// Notify the world we have a new key
		store.setState((state) => ({ ...state, keys: [key, ...state.keys] }));

		return key.id;
	} finally {
		setStatus({ store, status: "idle" });
	}
}

export async function importKey({
	store,
	keyData,
	format = "keydata",
	algorithm,
	extractable,
	keyUsages,
}: {
	store: Store<KeyStoreState>;
	keyData: Omit<KeyData, "id"> | Uint8Array | string;
	format?: KeyFormat;
	algorithm?:
		| Algorithm
		| "ed25519"
		| "ecc"
		| "xhd-root-key"
		| "xhd-derived-p256"
		| "xhd-derived-ed25519";
	extractable?: boolean;
	keyUsages?: KeyUsage[];
}): Promise<KeyId> {
	try {
		if (keyData instanceof Uint8Array || typeof keyData === "string") {
			const providedId = (keyData as any).id;
			const isSeedFormat =
				format === "seed" ||
				format === "bip39" ||
				format === "algo25" ||
				format === "keydata";

			if (
				algorithm === "ed25519" ||
				algorithm === "ecc" ||
				algorithm === "xhd-derived-ed25519"
			) {
				let currentSeedId: string | undefined;

				if (isSeedFormat) {
					currentSeedId = await importSeed({
						store,
						seed: keyData,
						id: providedId,
						algorithm:
							format === "seed" || format === "keydata"
								? "raw"
								: (format as any) || "raw",
						format:
							format === "seed" || format === "keydata"
								? "bytes"
								: (format as any) || "bytes",
					});
				}

				if (algorithm === "xhd-derived-ed25519") {
					// 1. Import/Derive the Root Key
					const rootKeyId = await importSeed({
						store,
						seed: keyData,
						type: "hd-root-key",
						name: "Imported Root Key",
						algorithm: isSeedFormat
							? format === "seed" || format === "keydata"
								? "raw"
								: (format as any)
							: "raw",
						format: isSeedFormat
							? format === "seed" || format === "keydata"
								? "bytes"
								: (format as any)
							: (format as any) || "bytes",
						metadata: { parentKeyId: currentSeedId },
					});

					// 2. Import the derived key
					// We need the raw bytes for derivation in importEd25519Key
					// We fetch them from the secret storage using the rootKeyId
					const rootKeyMaterial = await fetchSecret<SeedData>({
						keyId: rootKeyId,
					});

					return await importEd25519Key({
						store,
						keyData: {
							type: "hd-derived-ed25519",
							algorithm: "EdDSA",
							metadata: {
								parentKeyId: rootKeyId,
							},
						} as any,
						seed: rootKeyMaterial as SeedData,
						id: providedId,
						type: "hd-derived-ed25519",
					});
				}

				return await importEd25519Key({
					store,
					keyData,
					seed: currentSeedId ? ({ id: currentSeedId } as any) : undefined,
					id: providedId,
					format,
					extractable,
					keyUsages,
				});
			}

			if (algorithm === "xhd-root-key") {
				let parentSeedId: string | undefined;
				if (isSeedFormat) {
					parentSeedId = await importSeed({
						store,
						seed: keyData,
						algorithm:
							format === "seed" || format === "keydata"
								? "raw"
								: (format as any) || "raw",
						format:
							format === "seed" || format === "keydata"
								? "bytes"
								: (format as any) || "bytes",
					});
				}

				return await importSeed({
					store,
					seed: keyData,
					id: providedId,
					type: "hd-root-key",
					name: "Imported Root Key",
					algorithm: isSeedFormat
						? format === "seed" || format === "keydata"
							? "raw"
							: (format as any)
						: "raw",
					format: isSeedFormat
						? format === "seed" || format === "keydata"
							? "bytes"
							: (format as any)
						: (format as any) || "bytes",
					extractable,
					keyUsages,
					metadata: { parentKeyId: parentSeedId },
				});
			}

			if (keyData instanceof Uint8Array) {
				if (
					format &&
					format !== "raw" &&
					format !== "keydata" &&
					format !== "seed"
				) {
					throw new InvalidKeyDataError(
						"If format is specified, it must be 'raw' or 'seed'",
					);
				}
				if (!algorithm) {
					throw new InvalidKeyDataError("Algorithm must be specified");
				}

				throw new InvalidKeyDataError(
					`Unsupported algorithm for raw import: ${algorithm}`,
				);
			}
		}

		// Ensure this is a KeyData object
		if (typeof keyData !== "object" || !("type" in keyData)) {
			throw new InvalidKeyFormatError(
				"Only KeyData objects are allowed currently",
			);
		}

		switch (keyData.type) {
			case "hd-seed": {
				if (
					typeof keyData.privateKey === "undefined" ||
					!(keyData.privateKey instanceof Uint8Array)
				) {
					throw new InvalidKeyDataError(
						"Seed is required and must be a Uint8Array",
					);
				}
				return await importSeed({
					store,
					seed: keyData.privateKey,
					id: (keyData as any).id,
					name: (keyData as any).name,
					algorithm: keyData.algorithm as any,
					format: keyData.format as any,
					extractable: keyData.extractable,
					keyUsages: keyData.keyUsages,
				});
			}
			case "hd-root-key": {
				if (keyData.algorithm !== "raw" && keyData.format !== "raw") {
					throw new InvalidKeyDataError("Only supports importing raw seeds");
				}
				if (
					typeof keyData.privateKey === "undefined" ||
					!(keyData.privateKey instanceof Uint8Array)
				) {
					throw new InvalidKeyDataError(
						"Seed is required and must be a Uint8Array",
					);
				}
				return await importSeed({
					store,
					seed: keyData.privateKey as Uint8Array,
					id: (keyData as any).id,
					type: "hd-root-key",
					name: (keyData as any).name,
					algorithm: "raw", // root keys are always raw seeds
				});
			}
			case "ed25519":
			case "ecc":
			case "hd-derived-ed25519": {
				return await importEd25519Key({
					store,
					keyData: keyData as KeyData,
					id: (keyData as any).id,
					type: keyData.type === "ecc" ? "ed25519" : keyData.type,
				});
			}
			case "hd-derived-passkey": {
				return await importPasskey({ store, keyData: keyData as XHDDomainP256KeyData });
			}
			default: {
				throw new InvalidKeyDataError(`Unknown key type: ${keyData.type}`);
			}
		}
	} finally {
		setStatus({ store, status: "idle" });
	}
}
