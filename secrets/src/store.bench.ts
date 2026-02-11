import { Store } from "@tanstack/store";
import { bench, describe } from "vitest";
import { addSecret, getSecret, removeSecret } from "./store.js";
import type { Secret, SecretStoreState } from "./types.js";

describe("Secret Store Benchmarks", () => {
	const store = new Store<SecretStoreState>({
		secrets: [],
		activeSecret: null,
	});
	const testKey: Secret = {
		id: "test-key",
		name: "Benchmark Key",
		type: "algo25",
		value: "some-secret-value",
	};

	bench("addSecret", () => {
		addSecret({ store, secret: { ...testKey, id: Math.random().toString() } });
	});

	bench("getSecret", () => {
		getSecret({ store, secretId: "test-key" });
	});

	bench("removeSecret", () => {
		removeSecret({ store, secretId: "test-key" });
	});
});
