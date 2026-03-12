import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import {
	addKey,
	clearKeyStore,
	getKey,
	initializeKeyStore,
	removeKey,
	setStatus,
} from "./store.ts";
import type { KeyStoreState } from "./types/index.ts";

describe("store.ts", () => {
	const createStore = () =>
		new Store<KeyStoreState>({
			keys: [],
			status: "idle",
		});

	it("addKey adds a key to the store", () => {
		const store = createStore();
		const key = { id: "k1", type: "ed25519", algorithm: "EdDSA" } as any;
		addKey(store, key);
		expect(store.state.keys).toContain(key);
	});

	it("removeKey removes a key by id", () => {
		const store = createStore();
		const key = { id: "k1" } as any;
		store.setState({ keys: [key], status: "idle" });
		removeKey({ store, keyId: "k1" });
		expect(store.state.keys).not.toContain(key);
	});

	it("setStatus updates the status", () => {
		const store = createStore();
		setStatus({ store, status: "busy" });
		expect(store.state.status).toBe("busy");
	});

	it("clearKeyStore clears keys and resets status", () => {
		const store = createStore();
		store.setState({ keys: [{ id: "k1" } as any], status: "busy" });
		clearKeyStore({ store });
		expect(store.state.keys).toEqual([]);
		expect(store.state.status).toBe("idle");
	});

	it("getKey retrieves a key by id", () => {
		const store = createStore();
		const key = { id: "k1" } as any;
		store.setState({ keys: [key], status: "idle" });
		expect(getKey({ store, id: "k1" })).toBe(key);
		expect(getKey({ store, id: "non-existent" })).toBeUndefined();
	});

	it("initializeKeyStore sets keys and status", () => {
		const store = createStore();
		const keys = [{ id: "k1" } as any];
		initializeKeyStore({ store, keys });
		expect(store.state.keys).toBe(keys);
		expect(store.state.status).toBe("idle");
	});
});
