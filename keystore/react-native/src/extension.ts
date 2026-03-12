import {
	clearKeyData,
	decrypt,
	encrypt,
	InvalidKeyDataError,
	type KeyData,
	type KeyId,
	KeyNotFoundError,
	type KeyStoreAPI,
	type KeyStoreExtension,
	type KeyStoreOptions,
	requiresParentKey,
	sign,
	signWithKeyData,
	verify,
	type KeyFormat,
	type XHDDerivedKeyData,
	type XHDDomainP256KeyData,
} from "@algorandfoundation/keystore";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { context } from "./constants.ts";
import { fetchSecret } from "./storage/state.ts";
import * as store from "./store.ts";

/**
 * Wallet Provider Extension that adds Keystore functionality.
 *
 * It wraps a {@link KeyStoreAPI} to provide reactive state for keys and status,
 * and adds a hook system for intercepting operations.
 *
 * @param provider
 * @param options - Extension options
 * @param options.keystore.extension - The {@link KeyStoreAPI} extension configuration
 * @param options.api.keystore - The concrete {@link KeyStoreAPI} implementation to wrap
 *
 * @returns The {@link KeyStoreExtension} surface with reactive `keys` and an augmented `keystore` API.
 *
 * @example
 * ```typescript
 * const ProviderWithKeystore = Provider.withExtensions([WithKeyStore]);
 * const provider = new ProviderWithKeystore({
 *   api: { keystore: myKeystoreAPI }
 * });
 *
 * // Add hooks
 * provider.keystore.hooks.before("signing", ({ id }) => {
 *   console.log("About to sign with", id)
 * })
 * ```
 */
export const WithKeyStore: Extension<KeyStoreExtension> = (
	provider: Provider<any> & LogStoreExtension,
	options: KeyStoreOptions,
) => {
	const keyStore = options.keystore.store;
	const keyStoreHooks = options.keystore.hooks;
	const log = provider?.log || console;

	// Implement the extension surface with hooks
	return {
		/** Reactive state of all keys in the keystore */
		get keys() {
			return keyStore.state.keys;
		},
		/** Reactive status of the keystore (e.g., 'idle', 'commiting') */
		get status() {
			return keyStore.state.status;
		},
		/**
		 * The Keystore API for performing cryptographic operations.
		 * Maps to the underlying {@link KeyStoreAPI} implementation.
		 */
		key: {
			store: options?.api?.keystore || {
				list() {
					return keyStore.state.keys;
				},
				/** Generates a new key pair and stores it */
				generate: (options): Promise<KeyId> => {
					log.debug("(extension.ts) Generating Key", options, context);

					if (
						requiresParentKey(options) &&
						typeof options?.params?.parentKeyId === "undefined"
					) {
						throw new InvalidKeyDataError(
							"Parent key ID is required for generating derived keys",
						);
					}

					return keyStoreHooks("generate", store.generateKey, {
						log,
						store: keyStore,
						type: options.type,
						params: options.params,
						extractable: options.extractable,
						algorithm: options.algorithm,
						keyUsages: options.keyUsages,
					});
				},
				/** Imports an existing key into the keystore */
				import: (
					data,
					algorithmOrFormat?: string,
					format?: KeyFormat,
				): Promise<KeyId> => {
					const algorithm =
						typeof algorithmOrFormat === "string" &&
						algorithmOrFormat !== "raw" &&
						algorithmOrFormat !== "base64" &&
						algorithmOrFormat !== "keydata" &&
						algorithmOrFormat !== "bytes" &&
						algorithmOrFormat !== "seed"
							? (algorithmOrFormat as any)
							: undefined;
					const finalFormat =
						format ||
						(algorithmOrFormat === "raw" ||
						algorithmOrFormat === "base64" ||
						algorithmOrFormat === "keydata" ||
						algorithmOrFormat === "bytes" ||
						algorithmOrFormat === "seed"
							? (algorithmOrFormat as KeyFormat)
							: undefined);

					log.debug(
						"(extension.ts) Import Key",
						typeof data === "string" || data instanceof Uint8Array
							? { type: "raw", algorithm, format: finalFormat }
							: {
									...data.metadata,
									type: (data as any).type,
									algorithm: (data as any).algorithm,
								},
						context,
					);
					if (
						typeof data !== "string" &&
						!(data instanceof Uint8Array) &&
						(!(data.privateKey instanceof Uint8Array) ||
							data.privateKey instanceof Buffer)
					) {
						throw new InvalidKeyDataError(
							"Invalid key data format, must be string, Uint8Array, or have Uint8Array privateKey property",
						);
					}
					return store.importKey({
						store: keyStore,
						keyData: data,
						format: finalFormat,
						algorithm,
					});
				},
				/** Exports public key data for a given key ID */
				export: (id, options): Promise<KeyData> =>
					store.exportKey({ store: keyStore, id, options }),
				/** Removes a key from the keystore */
				remove: (id) =>
					keyStoreHooks(
						"remove",
						async function handleRemove({ keyId }: { keyId: KeyId }) {
							await store.removeKey({ store: keyStore, keyId });
						},
						{ keyId: id },
					),
				/** Clears all keys from the keystore */
				clear: () =>
					keyStoreHooks(
						"clear",
						async function handleClear() {
							await store.clear({ store: keyStore });
						},
						{},
					),
				/** Signs data using the private key associated with the ID */
				sign: (id, data): Promise<Uint8Array<ArrayBufferLike>> =>
					keyStoreHooks(
						"sign",
						async function handleSign({
							id,
							data,
						}: {
							id: string;
							data: Uint8Array<ArrayBufferLike>;
						}) {
							let key: KeyData | null = null;
							let parentKey: KeyData | null = null;
							try {
								key = await fetchSecret<KeyData>({ keyId: id });
								if (!key) {
									throw new KeyNotFoundError(id);
								}
								// We can assume if it has a parent key that it is an HD key
								if (
									typeof key?.metadata !== "undefined" &&
									typeof key?.metadata?.parentKeyId !== "undefined"
								) {
									parentKey = await fetchSecret<KeyData>({
										keyId: (key as XHDDerivedKeyData | XHDDomainP256KeyData)
											.metadata.parentKeyId,
									});
									if (!parentKey)
										throw new KeyNotFoundError(
											(key as XHDDerivedKeyData | XHDDomainP256KeyData).metadata
												.parentKeyId,
										);
								} else if (key?.metadata?.rootKey) {
									parentKey = key.metadata.rootKey as KeyData;
								}
								if (!parentKey) {
									throw new InvalidKeyDataError(
										"Missing parent key for HD key",
									);
								}
								// Ensure parent key is properly formatted for signing
								// Ed25519 expects an hd-root-key
								const finalParentKey = {
									...parentKey,
									type: "hd-root-key",
									format: "raw",
								} as any;
								return sign({
									store: keyStore,
									key,
									parentKey: finalParentKey,
									data,
								});
							} finally {
								clearKeyData(key);
								clearKeyData(parentKey);
							}
						},
						{ id, data },
					),
				/** Verifies a signature against data using the key associated with the ID */
				verify: (id, data, signature, algorithm): Promise<boolean> =>
					keyStoreHooks("verify", async () => {
						let key: KeyData | null = null;
						try {
							// Fetch the key from storage
							key = await fetchSecret<KeyData>({ keyId: id });
							if (!key) throw new KeyNotFoundError(id);
							// Verify the signature
							return verify({
								store: keyStore,
								key,
								data,
								signature,
								algorithm,
							});
						} finally {
							clearKeyData(key);
						}
					}),
				/** Imports a raw seed or BIP39 mnemonic for HD wallet derivation */
				importSeed: (seed, options): Promise<KeyId> =>
					store.importSeed({
						store: keyStore,
						seed,
						name: options?.name,
					}),
				/** Derives a new key from a stored seed using a path */
				deriveFromSeed: (seedId, path, options): Promise<KeyId> =>
					keyStoreHooks("deriveFromSeed", store.deriveFromSeed, {
						store: keyStore,
						seedId,
						path,
						options,
					}),
				/** Encrypts data using the key associated with the ID */
				encryptWithKey: (
					id,
					data,
					algorithm,
				): Promise<Uint8Array<ArrayBufferLike>> =>
					keyStoreHooks("encryptWithKey", async () => {
						let key: KeyData | null = null;
						try {
							key = await fetchSecret<KeyData>({ keyId: id });
							if (!key) throw new KeyNotFoundError(id);
							return encrypt({
								store: keyStore,
								key,
								data,
								algorithm,
							});
						} finally {
							clearKeyData(key);
						}
					}),
				/** Decrypts data using the key associated with the ID */
				decryptWithKey: (
					id,
					data,
					algorithm,
				): Promise<Uint8Array<ArrayBufferLike>> =>
					keyStoreHooks(
						"decryptWithKey",
						async () => {
							let key: KeyData | null = null;
							try {
								key = await fetchSecret<KeyData>({ keyId: id });
								if (!key) throw new KeyNotFoundError(id);
								return decrypt({ store: keyStore, key, data, algorithm });
							} finally {
								clearKeyData(key);
							}
						},
						{
							store: keyStore,
							id,
							data,
							algorithm,
						},
					),
				/** Signs multiple data items using multiple key IDs */
				batchSign: (ids, data): Promise<Uint8Array<ArrayBufferLike>[]> =>
					keyStoreHooks(
						"batchSign",
						async ({
							ids,
							data,
						}: {
							ids: KeyId[];
							data: Uint8Array<ArrayBufferLike>[];
						}) => {
							let keys: (KeyData | null)[] = [];
							let parentKeys: (KeyData | null)[] = [];
							try {
								keys = await Promise.all(
									ids.map((id) => fetchSecret<KeyData>({ keyId: id })),
								);
								parentKeys = await Promise.all(
									keys.map(async (key) => {
										if (!key) return null;
										let pKey: KeyData | null = null;
										if (key.metadata?.parentKeyId) {
											pKey = await fetchSecret<KeyData>({
												keyId: key.metadata.parentKeyId as string,
											});
										} else if (key.metadata?.rootKey) {
											pKey = key.metadata.rootKey as KeyData;
										}
										if (!pKey) return null;
										return {
											...pKey,
											type: "hd-root-key",
											format: "raw",
										} as any;
									}),
								);
								return Promise.all(
									keys.map((key, i) => {
										return key && parentKeys[i]
											? signWithKeyData({
													key,
													data: data[i] as Uint8Array<ArrayBufferLike>,
													parentKey: parentKeys[i] as KeyData,
												})
											: null;
									}),
								);
							} finally {
								keys.map(clearKeyData);
								parentKeys.map(clearKeyData);
							}
						},
						{
							ids,
							data,
						},
					),
				hooks: keyStoreHooks,
			},
		},
	} as KeyStoreExtension;
};
