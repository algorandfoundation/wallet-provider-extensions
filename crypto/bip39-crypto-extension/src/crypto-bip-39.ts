import type {
	KeyStoreApi,
	KeyStoreExtension,
	SecretKey,
} from "@algorandfoundation/keystore-extension";
// Base Abstractions
import type {
	BaseProvider,
	ExtensionOptions,
} from "@algorandfoundation/wallet-provider";
import * as bip39 from "@scure/bip39";
import { wordlist as englishWordList } from "@scure/bip39/wordlists/english.js";
import { v4 as uuid } from "uuid";

import { cryptoBip39Hooks } from "./crypto-bip-39.hooks.js"; // LifeCycle Integrations

// Extension Interfaces
export interface BIP39CryptoApi {
	add?: (options?: BIP39GenerationOptions) => Promise<SecretKey>;
	remove?: (id: string) => Promise<void>;
	import?: (options: BIP39ImportOptions) => Promise<SecretKey>;
	export?: (id: string) => Promise<SecretKey>;
	generate: (options?: BIP39GenerationOptions) => Promise<SecretKey>;
}

export interface BIP39CryptoExtension {
	crypto: {
		bip39: BIP39CryptoApi;
	};
}
export interface BIP39GenerationOptions {
	id?: string;
	name?: string;
	strength?: number;
	wordlist?: string[];
}

export interface BIP39ImportOptions {
	id?: string;
	name?: string;
	mnemonic: string;
	wordlist?: string[];
}

export const MISSING_KEYSTORE_ERROR =
	"Keystore is not available, ensure you have a keystore extension installed and declared above the crypto extension";

export const cryptoBIP39Extension = (
	provider: BaseProvider & KeyStoreExtension & { crypto: any },
	options: ExtensionOptions,
): BIP39CryptoExtension => {
	const keystore = provider.keystore as KeyStoreApi | undefined;

	// Extend BIP-39 with a Keystore when it is available
	const extended =
		options.keystore && keystore
			? {
					crypto: {
						bip39: {
							// The magic of hooks and interfaces!
							add: async (options?: BIP39GenerationOptions) =>
								await cryptoBip39Hooks("add", addMnemonic, {
									provider,
									secret: generateSecretKey(options),
								}),
							remove: async (id: string): Promise<void> =>
								await cryptoBip39Hooks("remove", removeMnemonic, {
									provider,
									id,
								}),
							import: async (options: BIP39ImportOptions): Promise<SecretKey> =>
								await cryptoBip39Hooks("import", importMnemonic, {
									provider,
									options,
								}),
							export: async (id: string): Promise<SecretKey> =>
								await cryptoBip39Hooks("export", exportMnemonic, {
									provider,
									id,
								}),
							generate: async (
								options?: BIP39GenerationOptions,
							): Promise<SecretKey> =>
								await cryptoBip39Hooks("generate", generateSecretKey, options),
						} as BIP39CryptoApi,
					},
				}
			: { crypto: {} as any };

	// Return the composed interface for BIP39 cryptographic operations
	return {
		crypto: {
			// Other crypto libraries for this provider
			...provider.crypto,
			// BIP39 Without a Keystore
			bip39: {
				// Handle Unavailable Keystore
				add: async () => {
					throw new Error(MISSING_KEYSTORE_ERROR);
				},
				remove: async () => {
					throw new Error(MISSING_KEYSTORE_ERROR);
				},
				import: async () => {
					throw new Error(MISSING_KEYSTORE_ERROR);
				},
				export: async () => {
					throw new Error(MISSING_KEYSTORE_ERROR);
				},
				...extended.crypto.bip39,
				generate: async (options?: BIP39GenerationOptions) =>
					await cryptoBip39Hooks("generate", generateSecretKey, options),
			} as BIP39CryptoApi,
		},
	};
};

// Custom API surface, which can be used but not dependent on as a concrete interface (outside usual semantic versioning)

export function generateSecretKey(
	options: BIP39GenerationOptions = { strength: 256 },
): SecretKey {
	return {
		id: options.id || uuid(),
		name: options.name || "Secret Key",
		value: bip39.generateMnemonic(englishWordList, options.strength),
		type: "bip39",
		metadata: {
			strength: options.strength,
			language: "english",
		},
	} as SecretKey;
}

// Provider dependant interfaces

export function addMnemonic({
	provider,
	secret,
}: {
	provider: BaseProvider & KeyStoreExtension;
	secret: SecretKey;
}): Promise<SecretKey> {
	const keystore = provider.keystore as KeyStoreApi | undefined;
	if (!keystore) throw new Error("Keystore is not available");
	return keystore.add({
		id: secret.id,
		name: secret.name,
		value: secret.value,
		type: secret.type,
		metadata: secret.metadata,
	});
}
export function removeMnemonic({
	provider,
	id,
}: {
	provider: BaseProvider & KeyStoreExtension;
	id: string;
}): Promise<void> {
	const keystore = provider.keystore as KeyStoreApi | undefined;
	if (!keystore) throw new Error("Keystore is not available");
	return keystore.remove(id);
}

export function importMnemonic({
	provider,
	options,
}: {
	provider: BaseProvider & KeyStoreExtension;
	options: BIP39ImportOptions;
}): Promise<SecretKey> {
	const keystore = provider.keystore as KeyStoreApi | undefined;
	if (!keystore) throw new Error("Keystore is not available");

	if (
		!bip39.validateMnemonic(
			options.mnemonic,
			options.wordlist || englishWordList,
		)
	) {
		throw new Error("Invalid Mnemonic");
	}

	return keystore.import({
		id: options.id || uuid(),
		name: options.name || "Secret Key",
		value: options.mnemonic,
		type: "bip39",
	});
}

export function exportMnemonic({
	provider,
	id,
}: {
	provider: BaseProvider & KeyStoreExtension;
	id: string;
}): Promise<SecretKey> {
	const keystore = provider.keystore as KeyStoreApi | undefined;
	if (!keystore) throw new Error("Keystore is not available");

	return keystore.export(id);
}
