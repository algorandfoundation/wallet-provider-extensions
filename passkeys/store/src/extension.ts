import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import {
	addPasskey,
	clearPasskeys,
	getPasskey,
	removePasskey,
} from "./store.js";
import type {
	Passkey,
	PasskeyStoreExtension,
	PasskeyStoreState,
} from "./types.js";

/**
 * An extension that provides a passkey store for managing passkeys.
 *
 * @param provider - The wallet provider.
 * @param options - The extension options.
 * @returns The passkey store extension.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider(..., {
 *   passkeys: {
 *     store: new Store({ passkeys: [] }),
 *     hooks: new HookCollection()
 *   }
 * });
 * ```
 */
export const WithPasskeyStore: Extension<PasskeyStoreExtension> = (
	_provider,
	options,
) => {
	const passkeyStore =
		options?.passkeys?.store ?? new Store<PasskeyStoreState>({ passkeys: [] });
	const passkeyHooks = options?.passkeys?.hooks ?? new Hook.Collection<any>();

	return {
		get passkeys() {
			return passkeyStore.state.passkeys;
		},
		passkey: {
			store: {
				addPasskey: async (passkey: Passkey) => {
					return passkeyHooks("add", addPasskey, {
						store: passkeyStore,
						passkey,
					});
				},
				removePasskey: async (id: string) => {
					return passkeyHooks("remove", removePasskey, {
						store: passkeyStore,
						id,
					});
				},
				getPasskey: async (id: string) => {
					return passkeyHooks("get", getPasskey, {
						store: passkeyStore,
						id,
					});
				},
				clear: async () => {
					return passkeyHooks("clear", clearPasskeys, {
						store: passkeyStore,
					});
				},
				hooks: passkeyHooks,
			},
		},
	} as PasskeyStoreExtension;
};
