import type { Store } from "@tanstack/store";
import type { Connection, ConnectionStoreState } from "./types.js";

/**
 * Adds a connection to the store.
 *
 * @param params - The add parameters.
 * @param params.store - The TanStack store instance for {@link ConnectionStoreState}.
 * @param params.connection - The {@link Connection} to add.
 * @returns The added {@link Connection}.
 *
 * @example
 * ```typescript
 * addConnection({ store, connection: { id: "1", name: "Pera" } });
 * ```
 */
export function addConnection({
	store,
	connection,
}: {
	store: Store<ConnectionStoreState>;
	connection: Connection;
}): Connection {
	store.setState((state) => {
		return {
			...state,
			connections: [connection, ...state.connections],
		};
	});
	return connection;
}

/**
 * Removes a connection from the store by its ID.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link ConnectionStoreState}.
 * @param params.id - The ID of the connection to remove.
 *
 * @example
 * ```typescript
 * removeConnection({ store, id: "1" });
 * ```
 */
export function removeConnection({
	store,
	id,
}: {
	store: Store<ConnectionStoreState>;
	id: string;
}): void {
	store.setState((state) => {
		return {
			...state,
			connections: state.connections.filter((connection) => connection.id !== id),
		};
	});
}

/**
 * Retrieves a connection from the store by its ID.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link ConnectionStoreState}.
 * @param params.id - The ID of the connection to retrieve.
 * @returns The {@link Connection} if found, otherwise undefined.
 *
 * @example
 * ```typescript
 * getConnection({ store, id: "1" });
 * ```
 */
export function getConnection({
	store,
	id,
}: {
	store: Store<ConnectionStoreState>;
	id: string;
}): Connection | undefined {
	return store.state.connections.find((connection) => connection.id === id);
}

/**
 * Clears all connections from the store.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link ConnectionStoreState}.
 *
 * @example
 * ```typescript
 * clearConnections({ store });
 * ```
 */
export function clearConnections({
	store,
}: {
	store: Store<ConnectionStoreState>;
}): void {
	store.setState((state) => {
		return {
			...state,
			connections: [],
		};
	});
}
