import type {
	KeyStoreExtension,
	KeyStoreOptions,
} from "@algorandfoundation/keystore";
import type {
	PasskeyStoreExtension,
	PasskeyStoreOptions,
	PasskeyStoreState,
} from "@algorandfoundation/passkey-store";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Options for the PasskeysKeystore extension.
 */
export interface PasskeysKeystoreExtensionOptions
	extends ExtensionOptions,
		PasskeyStoreOptions,
		KeyStoreOptions {
	passkeys: {
		store: Store<PasskeyStoreState>;
		hooks: HookCollection<any>;
		keystore: {
			/**
			 * Whether to automatically add passkeys for all compatible keys in the keystore.
			 * Defaults to true.
			 */
			autoPopulate?: boolean;
		};
	};
}

/**
 * The interface exposed by the Passkeys Keystore Extension.
 *
 * This extension bridges the Passkey Store and the Keystore,
 * providing passkeys that are backed by the keystore.
 */
export interface PasskeysKeystoreExtension
	extends PasskeyStoreExtension,
		KeyStoreExtension {}
