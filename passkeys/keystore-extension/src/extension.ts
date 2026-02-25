import type {
	Key,
	KeyStoreExtension,
	KeyStoreState,
	XHDPasskey,
} from "@algorandfoundation/keystore";
import type {
	Passkey,
	PasskeyStoreExtension,
} from "@algorandfoundation/passkey-store";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type {
	PasskeysKeystoreExtension,
	PasskeysKeystoreExtensionOptions,
} from "./types.ts";

/**
 * Extension that bridges the passkey store and keystore.
 *
 * It automatically populates the passkey store with passkeys from the keystore.
 */
export const WithPasskeysKeystore: Extension<PasskeysKeystoreExtension> = (
	provider: KeyStoreExtension & PasskeyStoreExtension,
	options: PasskeysKeystoreExtensionOptions,
) => {
	// Ensure dependencies are present
	if (!provider.passkey) {
		throw new Error(
			"PasskeysKeystore extension requires WithPasskeyStore extension to be present on the provider.",
		);
	}
	if (!provider.key) {
		throw new Error(
			"PasskeysKeystore extension requires WithKeyStore extension to be present on the provider.",
		);
	}

	const keyStore: Store<KeyStoreState> = options.keystore.store;
	const { autoPopulate = true } = options.passkeys.keystore ?? {};

	/**
	 * Creates a passkey object from a keystore key.
	 */
	const createPasskeyFromKey = (key: XHDPasskey): Passkey => {
		if (!key.publicKey) {
			throw new Error(`Key ${key.id} is missing public key`);
		}
		return {
			id: key.id,
			name: key.metadata.origin || "Unnamed Passkey",
			publicKey: key.publicKey,
			algorithm: key.algorithm || "ES256",
			metadata: {
				...key.metadata,
				keyId: key.id,
			},
		};
	};

	// Initial population if enabled
	if (autoPopulate) {
		const keys = [...((provider.keys as Key[]) ?? [])];
		for (const key of keys) {
			if (key.type === "hd-derived-passkey") {
				provider.passkey.store.addPasskey(createPasskeyFromKey(key as XHDPasskey));
			}
		}

		keyStore.subscribe((state) => {
			const newKeys = (state as unknown as KeyStoreState).keys;

			// Find keys that are in newKeys but not in our local keys list
			const addedKeys = newKeys.filter(
				(newKey) => !keys.some((existingKey) => existingKey.id === newKey.id),
			);

			if (addedKeys.length === 0) return;

			for (const k of addedKeys) {
				keys.push(k);
				if (k.type === "hd-derived-passkey") {
					provider.passkey.store.addPasskey(createPasskeyFromKey(k as XHDPasskey));
				}
			}
		});

		// Listen for new keys added to the keystore via hooks
		provider.key.store.hooks.after("generate", async () => {
			// The subscriber above should handle the state update,
			// but we can add specific logic here if needed.
		});
	}

	return provider as unknown as PasskeysKeystoreExtension;
};
