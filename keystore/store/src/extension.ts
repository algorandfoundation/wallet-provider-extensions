import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import type { KeyStoreAPI } from "./types/backend.ts";
import type { KeyStoreExtension, KeyStoreState } from "./types/extension.ts";

/**
 * A "not implemented" placeholder for the KeyStoreAPI.
 *
 * This can be used as a default implementation or for testing purposes.
 * Every method in this implementation throws an error.
 *
 * @example
 * ```typescript
 * import { KeyStoreNotImplemented } from "@algorandfoundation/keystore";
 *
 * // Use as a base for a partial implementation
 * const MyPartialKeyStore = {
 *   ...KeyStoreNotImplemented,
 *   generate: async () => { ... }
 * };
 * ```
 */
export const KeyStoreNotImplemented: KeyStoreAPI = {
	generate: async () => {
		throw new Error("KeyStore method 'generate' not implemented.");
	},
	import: async () => {
		throw new Error("KeyStore method 'import' not implemented.");
	},
	export: async () => {
		throw new Error("KeyStore method 'export' not implemented.");
	},
	remove: async () => {
		throw new Error("KeyStore method 'remove' not implemented.");
	},
	sign: async () => {
		throw new Error("KeyStore method 'sign' not implemented.");
	},
	verify: async () => {
		throw new Error("KeyStore method 'verify' not implemented.");
	},
	encryptWithKey: async () => {
		throw new Error("KeyStore method 'encryptWithKey' not implemented.");
	},
	decryptWithKey: async () => {
		throw new Error("KeyStore method 'decryptWithKey' not implemented.");
	},
	deriveSharedSecret: async () => {
		throw new Error("KeyStore method 'deriveSharedSecret' not implemented.");
	},
	importSeed: async () => {
		throw new Error("KeyStore method 'importSeed' not implemented.");
	},
	deriveFromSeed: async () => {
		throw new Error("KeyStore method 'deriveFromSeed' not implemented.");
	},
	encryptData: async () => {
		throw new Error("KeyStore method 'encryptData' not implemented.");
	},
	decryptData: async () => {
		throw new Error("KeyStore method 'decryptData' not implemented.");
	},
	logAuditEvent: async () => {
		throw new Error("KeyStore method 'logAuditEvent' not implemented.");
	},
	getAuditLogs: async () => {
		throw new Error("KeyStore method 'getAuditLogs' not implemented.");
	},
	batchSign: async () => {
		throw new Error("KeyStore method 'batchSign' not implemented.");
	},
};

/**
 * An extension that provides a keystore for managing cryptographic keys.
 *
 * @param _provider - The wallet provider instance being extended.
 * @param options - The extension configuration options.
 * @returns The keystore extension surface.
 *
 * @example
 * ```typescript
 * import { Provider } from "@algorandfoundation/wallet-provider";
 * import { WithKeyStore } from "@algorandfoundation/keystore";
 *
 * const MyProvider = Provider.withExtensions([WithKeyStore]);
 * const provider = new MyProvider({}, {
 *   key: {
 *     store: myKeyStoreImplementation,
 *     hooks: myKeyStoreHooks
 *   }
 * });
 *
 * console.log(provider.keys);
 * ```
 */
export const WithKeyStore: Extension<KeyStoreExtension> = (
	_provider,
	options,
) => {
	const keyStore =
		options?.keystore?.store ??
		new Store<KeyStoreState>({ keys: [], status: "idle" });
	const keyStoreHooks = options?.keystore?.hooks ?? new Hook.Collection<any>();
	const api = options?.api?.keystore ?? KeyStoreNotImplemented;

	return {
		get keys() {
			return keyStore.state.keys;
		},
		get status() {
			return keyStore.state.status;
		},
		key: {
			store: {
				...api,
				hooks: keyStoreHooks,
			},
		},
	} as KeyStoreExtension;
};
