import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import {
	addConnection,
	clearConnections,
	getConnection,
	removeConnection,
} from "./store.js";
import type {
	Connection,
	ConnectionStoreExtension,
	ConnectionStoreState,
} from "./types.js";

/**
 * An extension that provides a connection store for managing connections.
 *
 * @param provider - The wallet provider.
 * @param options - The extension options.
 * @returns The connection store extension.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider(..., {
 *   connections: {
 *     store: new Store({ connections: [] }),
 *     hooks: new HookCollection()
 *   }
 * });
 * ```
 */
export const WithConnectionStore: Extension<ConnectionStoreExtension> = (
	_provider,
	options,
) => {
	const connectionStore =
		options?.connections?.store ??
		new Store<ConnectionStoreState>({ connections: [] });
	const connectionHooks =
		options?.connections?.hooks ?? new Hook.Collection<any>();

	return {
		get connections() {
			return connectionStore.state.connections;
		},
		connection: {
			store: {
				addConnection: async (connection: Connection) => {
					return connectionHooks("add", addConnection, {
						store: connectionStore,
						connection,
					});
				},
				removeConnection: async (id: string) => {
					return connectionHooks("remove", removeConnection, {
						store: connectionStore,
						id,
					});
				},
				getConnection: async (id: string) => {
					return connectionHooks("get", getConnection, {
						store: connectionStore,
						id,
					});
				},
				clear: async () => {
					return connectionHooks("clear", clearConnections, {
						store: connectionStore,
					});
				},
				hooks: connectionHooks,
			},
		},
	} as ConnectionStoreExtension;
};
