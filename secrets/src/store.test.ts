import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import { withSecretStoreExtension } from "./extension.js";
import { addSecret, getSecret, removeSecret } from "./store.js";
import type { Secret, SecretStoreState } from "./types.js";

describe("Secret Store Extension", () => {
	it("should align with README usage", async () => {
		const MyProvider = Provider.withExtensions([withSecretStoreExtension]);
		const provider = new MyProvider({ id: "test", name: "Test" }) as any;

		const testKey: Secret = {
			id: "my-key-1",
			name: "Main Account",
			type: "algo25",
			value: "...",
		};
		// Access secret store methods
		await provider.secret.add(testKey);
		expect(provider.secrets).toHaveLength(1);
		expect(provider.secrets[0]).toEqual(testKey);

		await provider.secret.remove("my-key-1");
		expect(provider.secrets).toHaveLength(0);
	});

	describe("store functions", () => {
		it("should add a secret", () => {
			const store = new Store<SecretStoreState>({
				secrets: [],
				activeSecret: null,
			});
			const secret: Secret = {
				id: "1",
				name: "test",
				type: "algo25",
				value: "val",
			};
			addSecret({ store, secret });
			expect(store.state.secrets).toContain(secret);
		});

		it("should remove a secret", () => {
			const secret: Secret = {
				id: "1",
				name: "test",
				type: "algo25",
				value: "val",
			};
			const store = new Store<SecretStoreState>({
				secrets: [secret],
				activeSecret: secret,
			});
			removeSecret({ store, secretId: "1" });
			expect(store.state.secrets).not.toContain(secret);
		});

		it("should get a secret", () => {
			const secret: Secret = {
				id: "1",
				name: "test",
				type: "algo25",
				value: "val",
			};
			const store = new Store<SecretStoreState>({
				secrets: [secret],
				activeSecret: secret,
			});
			const found = getSecret({ store, secretId: "1" });
			expect(found).toEqual(secret);
		});

		it("should return undefined for non-existent secret", () => {
			const store = new Store<SecretStoreState>({
				secrets: [],
				activeSecret: null,
			});
			const found = getSecret({ store, secretId: "non-existent" });
			expect(found).toBeUndefined();
		});
	});
});
