import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Options for the ConnectionStore extension.
 */
export interface ConnectionStoreOptions extends ExtensionOptions {
	connections: {
		store: Store<ConnectionStoreState>;
		hooks: HookCollection<any>;
	};
}

/**
 * Represents a connection.
 */
export interface Connection {
	/**
	 * The unique ID of the connection.
	 */
	id: string;

	/**
	 * The name of the connection.
	 */
	name: string;

	/**
	 * The metadata associated with the connection.
	 */
	metadata?: Record<string, any>;
}

/**
 * The state of the connection store.
 */
export interface ConnectionStoreState {
	/**
	 * The list of connections in the store.
	 */
	connections: Connection[];
}

/**
 * Represents a connection store interface for managing connections.
 */
export interface ConnectionStoreExtension extends ConnectionStoreState {
	/**
	 * An object that represents additional functionality provided by this extension.
	 */
	connection: {
		store: ConnectionStoreApi;
	};
}

/**
 * Interface representing a ConnectionStore extension API.
 */
export interface ConnectionStoreApi {
	/**
	 * Adds a connection to the store.
	 *
	 * @param connection - The connection to add.
	 * @returns The added connection.
	 */
	addConnection: (connection: Connection) => Promise<Connection>;
	/**
	 * Removes a connection from the store by its ID.
	 *
	 * @param id - The ID of the connection to remove.
	 * @returns A promise that resolves when the connection is removed.
	 */
	removeConnection: (id: string) => Promise<void>;
	/**
	 * Retrieves a connection from the store by its ID.
	 *
	 * @param id - The ID of the connection to retrieve.
	 * @returns The connection if found, otherwise undefined.
	 */
	getConnection: (id: string) => Promise<Connection | undefined>;
	/**
	 * Clears all connections from the store.
	 *
	 * @returns A promise that resolves when the store is cleared.
	 */
	clear: () => Promise<void>;
	/**
	 * The hooks for connection store operations.
	 */
	hooks: HookCollection<any>;
}
