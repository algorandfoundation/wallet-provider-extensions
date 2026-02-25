import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import { WithConnectionStore } from "./extension.js";
import {
	addConnection,
	clearConnections,
	getConnection,
	removeConnection,
} from "./store.js";
import type { Connection, ConnectionStoreState } from "./types.js";

describe("Connection Store Extension", () => {
	it("should work with Provider", async () => {
		const MyProvider = Provider.withExtensions([WithConnectionStore]);
		const provider = new MyProvider({ id: "test", name: "Test" }) as any;

		const mockConnection: Connection = {
			id: "pera",
			name: "Pera Wallet",
		};

		await provider.connection.store.addConnection(mockConnection);
		expect(provider.connections).toHaveLength(1);
		expect(provider.connections[0].id).toEqual("pera");

		const found = await provider.connection.store.getConnection("pera");
		expect(found).toEqual(mockConnection);

		await provider.connection.store.removeConnection("pera");
		expect(provider.connections).toHaveLength(0);

		await provider.connection.store.addConnection(mockConnection);
		await provider.connection.store.clear();
		expect(provider.connections).toHaveLength(0);
	});

	describe("store functions", () => {
		it("should add a connection", () => {
			const store = new Store<ConnectionStoreState>({
				connections: [],
			});
			const connection: Connection = {
				id: "1",
				name: "Test Connection",
			};
			addConnection({ store, connection });
			expect(store.state.connections).toContain(connection);
		});

		it("should remove a connection", () => {
			const connection: Connection = {
				id: "1",
				name: "Test Connection",
			};
			const store = new Store<ConnectionStoreState>({
				connections: [connection],
			});
			removeConnection({ store, id: "1" });
			expect(store.state.connections).not.toContain(connection);
		});

		it("should get a connection", () => {
			const connection: Connection = {
				id: "1",
				name: "Test Connection",
			};
			const store = new Store<ConnectionStoreState>({
				connections: [connection],
			});
			const found = getConnection({ store, id: "1" });
			expect(found).toEqual(connection);
		});

		it("should return undefined for non-existent connection", () => {
			const store = new Store<ConnectionStoreState>({
				connections: [],
			});
			const found = getConnection({ store, id: "non-existent" });
			expect(found).toBeUndefined();
		});

		it("should clear connections", () => {
			const connection: Connection = {
				id: "1",
				name: "Test Connection",
			};
			const store = new Store<ConnectionStoreState>({
				connections: [connection],
			});
			clearConnections({ store });
			expect(store.state.connections).toHaveLength(0);
		});
	});
});
