// Library Requirements

import { DeterministicP256 } from "@algorandfoundation/dp256";
// Framework Requirements
import type { Secret, SecretId } from "@algorandfoundation/secret-store";
import type { Extension } from "@algorandfoundation/wallet-provider";
import { XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
import * as bip39 from "@scure/bip39";
import { Store } from "@tanstack/store";
import Hook, { type HookCollection } from "before-after-hook";

// Internal Requirements

import {
	batchSign,
	decryptData,
	decryptWithKey,
	deriveFromSeed,
	deriveSharedSecret,
	encryptData,
	encryptWithKey,
	generateKey,
	sign,
	verify,
} from "./crypto.ts";
import { exportKey, importKey, importSeed, removeKey } from "./store.ts";
// Local definitions
import type {
	DeriveOptions,
	ExportOptions,
	GenerateOptions,
	Key,
	KeyId,
	KeyStoreContext,
	KeyStoreExtension,
	KeyStoreExtensionOptions,
	KeyStoreState,
} from "./types.ts";

// LifeCycle Hooks, collects events for callers
export const keyStoreHooks: HookCollection<
	Record<
		string,
		{
			Options?: any;
			Result?: any;
			Error?: any;
		}
	>,
	string
> = new Hook.Collection();

// Store Instance, reflects the state of the keystore
export const keyStore: Store<
	KeyStoreState,
	(cb: KeyStoreState) => KeyStoreState
> = new Store<KeyStoreState>({
	keys: [],
	activeKey: null,
});

// Implementation of the KeyStore Extension, this is where the state is composed with our concrete interfaces
export const withKeyStoreExtension: Extension<KeyStoreExtension> = (
	provider: KeyStoreContext & { crypto: any },
	_options: KeyStoreExtensionOptions,
): KeyStoreExtension => {
	// TODO: lift this to the Provider library for default errors like missing extensions
	if (typeof provider.secrets === "undefined" && provider.secrets !== null)
		throw new Error(
			"The secrets store extension must be installed before the keystore extension",
		);

	return {
		get keys() {
			return keyStore.state.keys;
		},
		get activeKey() {
			return keyStore.state.activeKey;
		},
		crypto: {
			...provider.crypto,
			bip39,
			xhd: new XHDWalletAPI(),
			dp256: new DeterministicP256(),
		},
		// Massage the API with hooks
		keystore: {
			generate: async (options: GenerateOptions): Promise<Key> =>
				await keyStoreHooks("generate", generateKey, options),
			import: async (key: Key): Promise<Key> =>
				await keyStoreHooks("import", importKey, {
					provider,
					store: keyStore,
					key,
				}),
			export: async (id: KeyId, options?: ExportOptions): Promise<Key> =>
				await keyStoreHooks("export", exportKey, {
					store: keyStore,
					id,
					options,
				}),
			remove: async (id: KeyId): Promise<void> =>
				await keyStoreHooks("remove", removeKey, { store: keyStore, id }),
			sign: (
				id: KeyId,
				data: Uint8Array,
				algorithm?: string,
			): Promise<Uint8Array> =>
				keyStoreHooks("sign", sign, {
					store: keyStore,
					provider,
					id,
					data,
					algorithm,
				}),
			verify: async (
				id: KeyId,
				data: Uint8Array,
				signature: Uint8Array,
				algorithm?: string,
			): Promise<boolean> => {
				const key = exportKey({ store: keyStore, id });
				return keyStoreHooks("verify", verify, {
					provider,
					key,
					data,
					signature,
					algorithm,
				});
			},
			encryptWithKey: async (
				id: KeyId,
				data: Uint8Array,
				algorithm?: string,
			): Promise<Uint8Array> => {
				const key = exportKey({ store: keyStore, id });
				return keyStoreHooks("encryptWithKey", encryptWithKey, {
					key,
					data,
					algorithm,
				});
			},
			decryptWithKey: async (
				id: KeyId,
				data: Uint8Array,
				algorithm?: string,
			): Promise<Uint8Array> => {
				const key = exportKey({ store: keyStore, id });
				return keyStoreHooks("decryptWithKey", decryptWithKey, {
					key,
					data,
					algorithm,
				});
			},
			deriveSharedSecret: (
				id: KeyId,
				publicKey: Uint8Array,
				algorithm?: string,
			): Promise<Uint8Array> =>
				keyStoreHooks("deriveSharedSecret", deriveSharedSecret, {
					id,
					publicKey,
					algorithm,
				} as Key),
			importSeed: (secret: Secret, key: Key): Promise<KeyId> =>
				keyStoreHooks("importSeed", importSeed, {
					store: keyStore,
					provider,
					key,
					secret,
				}),
			deriveFromSeed: async (
				seedId: SecretId,
				path: string,
				options?: DeriveOptions,
			): Promise<KeyId> => {
				const key = await keyStoreHooks("deriveFromSeed", deriveFromSeed, {
					store: keyStore,
					provider,
					secretId: seedId,
					path,
					options,
				});
				return key.id;
			},
			encryptData: async (
				data: Uint8Array,
				passphrase?: string,
			): Promise<Uint8Array> =>
				await keyStoreHooks("encryptData", encryptData, { data, passphrase }),
			decryptData: async (
				data: Uint8Array,
				passphrase?: string,
			): Promise<Uint8Array> =>
				await keyStoreHooks("decryptData", decryptData, { data, passphrase }),
			batchSign: (ids: KeyId[], data: Uint8Array[]): Promise<Uint8Array[]> =>
				keyStoreHooks("batchSign", batchSign, {
					store: keyStore,
					provider,
					ids,
					data,
				}),
		},
	};
};
