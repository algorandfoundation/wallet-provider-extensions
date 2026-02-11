// Core Dependencies
import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook, { type HookCollection } from "before-after-hook";

// Store Mutations
import { addSecret, getSecret, removeSecret } from "./store.ts";

// Interface Types
import type {
	Secret,
	SecretStoreExtension,
	SecretStoreState,
} from "./types.ts";

// LifeCycle Hooks, collects events for callers
export const secretStoreHooks: HookCollection<
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

// Store Instance
export const secretsStore: Store<
	SecretStoreState,
	(cb: SecretStoreState) => SecretStoreState
> = new Store<SecretStoreState>({
	secrets: [],
	activeSecret: null,
});
export const withSecretStoreExtension: Extension<SecretStoreExtension> = (
	provider,
) => {
	// Capture state changes by defining the properties on the provider
	// TODO: the new provider can support getters, we should be able to remove this
	Object.defineProperty(provider, "secrets", {
		get() {
			return secretsStore.state.secrets;
		},
		enumerable: true,
		configurable: true,
	});

	Object.defineProperty(provider, "activeSecret", {
		get() {
			return secretsStore.state.activeSecret;
		},
		enumerable: true,
		configurable: true,
	});

	return {
		secret: {
			add: async (secret: Secret) =>
				await secretStoreHooks("add", addSecret, {
					store: secretsStore,
					secret,
				}),
			remove: async (id: string) =>
				await secretStoreHooks("remove", removeSecret, {
					store: secretsStore,
					secretId: id,
				}),
			getById: async (id: string) =>
				await secretStoreHooks("get", getSecret, {
					store: secretsStore,
					secretId: id,
				}),
		},
	} as SecretStoreExtension;
};
