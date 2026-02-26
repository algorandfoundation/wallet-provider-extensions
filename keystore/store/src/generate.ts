import { clearBuffer, generateId } from "@algorandfoundation/wallet-provider";
import {
	BIP32DerivationType,
	fromSeed,
	KeyContext,
} from "@algorandfoundation/xhd-wallet-api";
import * as bip39 from "@scure/bip39";
import { wordlist as englishWordList } from "@scure/bip39/wordlists/english.js";
import { clearKeyData, getBIP44PathFromContext } from "./crypto.ts";
import { encodeAddress } from "./encoding.ts";
import { InvalidKeyDataError } from "./errors.ts";
import { dp256, xhd } from "./libs.ts";
import type {
	Key,
	KeyData,
	SeedData,
	XHDDerivedKeyData,
	XHDPasskey,
	XHDRootKey,
} from "./types/index.ts";

/**
 * Options for BIP39 mnemonic generation.
 */
export interface BIP39GenerationOptions {
	/** Optional ID for the generated key */
	id?: string;
	/** Optional name for the generated key */
	name?: string;
	/** Strength of the mnemonic (128, 256 bits) */
	strength?: number;
	/** Wordlist to use for the mnemonic */
	wordlist?: string[];
	/** Whether the generated key is extractable */
	extractable?: boolean;
	/** Optional passphrase for the seed */
	passphrase?: string;
}

/**
 * Generates a new HD seed from a BIP39 mnemonic.
 * @param options - Generation options
 * @returns The generated seed data
 */
export async function generateSeedData(
	options: BIP39GenerationOptions = { strength: 256 },
): Promise<KeyData> {
	return {
		id: generateId(),
		type: "hd-seed",
		name: options.name || "Secret Key",
		algorithm: "raw",
		format: "bytes",
		extractable: true,
		keyUsages: ["deriveKey", "deriveBits"],
		// TODO: Use entropy instead of mnemonic, we may want to store the mnemonic since it has extra information and secrets like passphrase
		privateKey: await bip39.mnemonicToSeed(
			bip39.generateMnemonic(englishWordList, options.strength),
			options.passphrase,
		),
		metadata: {
			protected: options.passphrase ? true : undefined,
			strength: options.strength,
			language: "english",
		},
	} as SeedData;
}

/**
 * Generates an XHD root key from a seed.
 * @param seed - The seed data to use
 * @returns The generated root key
 */
export async function generateXHDRootKeyFromSeed(
	seed: SeedData,
): Promise<XHDRootKey> {
	try {
		if (
			seed.type !== "hd-seed" ||
			typeof seed.privateKey === "undefined" ||
			!(seed.privateKey instanceof Uint8Array)
		) {
			throw new InvalidKeyDataError("XHD root keys require a raw hd-seed");
		}
		const id = generateId();
		return {
			id,
			type: "hd-root-key",
			algorithm: "raw",
			format: "bytes",
			extractable: true,
			keyUsages: ["deriveKey", "deriveBits"],
			// TODO: fix parameters in XHD fromSeed
			privateKey: fromSeed(new Uint8Array(seed.privateKey) as any),
			metadata: {
				rootKeyId: seed.id,
			},
		} as XHDRootKey;
	} finally {
		clearKeyData(seed);
	}
}

/**
 * Generates a derived key or passkey from a parent root key.
 * @param params - The generation parameters
 * @param params.key - Partial key data for the derived key
 * @param params.parentKey - The parent root key
 * @returns The fully populated derived key or passkey
 */
export async function generateXHDFromParent({
	key,
	parentKey,
}: {
	key: Partial<XHDDerivedKeyData> | Partial<XHDPasskey>;
	parentKey: XHDRootKey;
}): Promise<XHDDerivedKeyData | XHDPasskey> {
	const id = generateId();

	let pk: Uint8Array<ArrayBufferLike> | undefined;
	try {
		switch (key.type) {
			case "hd-derived-ed25519": {
				if (
					typeof parentKey.privateKey === "undefined" ||
					!(parentKey.privateKey instanceof Uint8Array) ||
					parentKey.type !== "hd-root-key"
				) {
					throw new InvalidKeyDataError(
						"XHD derived keys require a raw hd-root-key",
					);
				}

				const metadata = key.metadata
					? {
							path:
								key.metadata.path ??
								getBIP44PathFromContext(
									key.metadata?.context ?? KeyContext.Address,
									key.metadata?.account ?? 0,
									key.metadata?.index ?? 0,
								),
							context: key.metadata.context ?? KeyContext.Address,
							account: key.metadata.account ?? 0,
							index: key.metadata.index ?? 0,
							derivation:
								key.metadata.derivation ?? BIP32DerivationType.Peikert,
						}
					: {
							path: getBIP44PathFromContext(KeyContext.Address, 0, 0),
							context: KeyContext.Address,
							account: 0,
							index: 0,
							derivation: BIP32DerivationType.Peikert,
						};

				pk = await xhd.keyGen(
					parentKey.privateKey,
					metadata.context ?? KeyContext.Address,
					metadata.account ?? 0,
					metadata.index ?? 0,
					metadata.derivation ?? BIP32DerivationType.Peikert,
				);
				return {
					...key,
					id,
					algorithm: "EdDSA",
					format: "bytes",
					extractable: true,
					publicKey: new Uint8Array(pk),
					metadata: {
						...metadata,
						address: {
							algorand: encodeAddress(pk),
						},
						parentKeyId: parentKey.id,
					},
				} as XHDDerivedKeyData;
			}
			case "hd-derived-passkey": {
				if (
					typeof parentKey.privateKey === "undefined" ||
					!(parentKey.privateKey instanceof Uint8Array) ||
					parentKey.type !== "hd-root-key"
				) {
					throw new InvalidKeyDataError(
						"XHD derived keys require a raw hd-root-key",
					);
				}

				const metadata = key.metadata
					? {
							...key.metadata,
							origin: key.metadata.origin ?? "default",
							userHandle: key.metadata.userHandle ?? "default",
							counter: key.metadata.counter ?? 0,
						}
					: {
							origin: "default",
							userHandle: "default",
							counter: 0,
						};
				pk = await dp256.genDomainSpecificKeyPair(
					parentKey.privateKey,
					metadata.origin,
					metadata.userHandle,
					metadata.counter,
				);
				return {
					...key,
					id,
					algorithm: "P256",
					format: "bytes",
					extractable: true,
					publicKey: dp256.getPurePKBytes(pk),
					privateKey: { ...pk },
					metadata: {
						...metadata,
						parentKeyId: parentKey.id,
					},
				} as XHDPasskey;
			}
			default:
				throw new InvalidKeyDataError("Invalid key type");
		}
	} finally {
		clearKeyData(key);
		clearKeyData(parentKey);
		clearBuffer(pk);
	}
}

export async function generateKey({
	keyData,
	parentKey,
}: {
	keyData: Omit<Key, "id">;
	parentKey?: XHDRootKey | SeedData | null;
}): Promise<KeyData> {
	const id = generateId();

	if (typeof keyData.metadata === "undefined") {
		throw new InvalidKeyDataError("Key metadata is required");
	}
	try {
		switch (keyData.algorithm) {
			case "raw": {
				switch (keyData.type) {
					case "hd-seed": {
						return {
							...keyData,
							...(await generateSeedData()),
							id,
						} as SeedData;
					}
					case "hd-root-key": {
						if (typeof keyData.metadata.parentKeyId === "undefined") {
							throw new InvalidKeyDataError(
								"XHD derived keys require a rootKeyId, please upload it first using importSeed()",
							);
						}
						if (!parentKey || !(parentKey?.privateKey instanceof Uint8Array))
							throw new InvalidKeyDataError(
								"Seed is required to generate root key and must be a Uint8Array",
							);
						return {
							...keyData,
							...(await generateXHDRootKeyFromSeed(parentKey as SeedData)),
							id,
						} as XHDRootKey;
					}
					default: {
						throw new InvalidKeyDataError(`Unknown key type: ${keyData.type}`);
					}
				}
			}
			case "EdDSA": {
				if (typeof keyData.metadata.parentKeyId === "undefined") {
					throw new InvalidKeyDataError(
						"XHD derived keys require a rootKeyId, please upload it first using importSeed()",
					);
				}
				if (!parentKey || !(parentKey?.privateKey instanceof Uint8Array))
					throw new InvalidKeyDataError(
						"Seed is required to generate root key",
					);
				keyData.type = "hd-derived-ed25519";
				return {
					...keyData,
					...(await generateXHDFromParent({
						key: keyData as XHDDerivedKeyData,
						parentKey: parentKey as XHDRootKey,
					})),
					id,
				} as XHDDerivedKeyData;
			}

			case "P256": {
				if (typeof keyData.metadata.parentKeyId === "undefined") {
					throw new InvalidKeyDataError(
						"dP256 require a rootKeyId, please upload it first using importSeed()",
					);
				}
				if (
					!(
						parentKey &&
						parentKey.type === "hd-root-key" &&
						parentKey.privateKey instanceof Uint8Array
					)
				)
					throw new InvalidKeyDataError("Seed is required to generate passkey");

				keyData.type = "hd-derived-passkey";
				return {
					...keyData,
					...(await generateXHDFromParent({
						key: keyData as XHDPasskey,
						parentKey: parentKey as XHDRootKey,
					})),
				};
			}
			default: {
				throw new InvalidKeyDataError(
					`Unknown algorithm: ${keyData.algorithm}`,
				);
			}
		}
	} finally {
		clearKeyData(keyData);
		clearKeyData(parentKey);
	}
}
