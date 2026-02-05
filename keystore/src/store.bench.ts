import { Store } from "@tanstack/store";
import { bench, describe } from "vitest";
import {
	addSecret,
	getSecret,
	type KeyStoreState,
	removeSecret,
} from "./store.js";
import type { SecretKey } from "./types.js";

describe("Keystore Benchmarks", () => {
	const store = new Store<KeyStoreState>({ secrets: [] });
	const testKey: SecretKey = {
		id: "test-key",
		name: "Benchmark Key",
		type: "algo25",
		value: "some-secret-value",
	};

	bench("addSecret", () => {
		addSecret(store, { ...testKey, id: Math.random().toString() });
	});

	bench("getSecret", () => {
		getSecret(store, "test-key");
	});

	bench("removeSecret", () => {
		removeSecret(store, "test-key");
	});
});
