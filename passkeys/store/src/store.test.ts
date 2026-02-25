import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import { WithPasskeyStore } from "./extension.js";
import {
	addPasskey,
	clearPasskeys,
	getPasskey,
	removePasskey,
} from "./store.js";
import type { Passkey, PasskeyStoreState } from "./types.js";

describe("Passkey Store Extension", () => {
	it("should work with Provider", async () => {
		const MyProvider = Provider.withExtensions([WithPasskeyStore]);
		const provider = new MyProvider({ id: "test", name: "Test" }) as any;

		const mockPasskey: Passkey = {
			id: "cred-1",
			name: "Work Laptop",
			publicKey: new Uint8Array([1, 2, 3]),
			algorithm: "ES256",
		};

		await provider.passkey.store.addPasskey(mockPasskey);
		expect(provider.passkeys).toHaveLength(1);
		expect(provider.passkeys[0].id).toEqual("cred-1");

		const found = await provider.passkey.store.getPasskey("cred-1");
		expect(found).toEqual(mockPasskey);

		await provider.passkey.store.removePasskey("cred-1");
		expect(provider.passkeys).toHaveLength(0);

		await provider.passkey.store.addPasskey(mockPasskey);
		await provider.passkey.store.clear();
		expect(provider.passkeys).toHaveLength(0);
	});

	describe("store functions", () => {
		it("should add a passkey", () => {
			const store = new Store<PasskeyStoreState>({
				passkeys: [],
			});
			const passkey: Passkey = {
				id: "1",
				name: "Test Passkey",
				publicKey: new Uint8Array([4, 5, 6]),
				algorithm: "ES256",
			};
			addPasskey({ store, passkey });
			expect(store.state.passkeys).toContain(passkey);
		});

		it("should remove a passkey", () => {
			const passkey: Passkey = {
				id: "1",
				name: "Test Passkey",
				publicKey: new Uint8Array([4, 5, 6]),
				algorithm: "ES256",
			};
			const store = new Store<PasskeyStoreState>({
				passkeys: [passkey],
			});
			removePasskey({ store, id: "1" });
			expect(store.state.passkeys).not.toContain(passkey);
		});

		it("should get a passkey", () => {
			const passkey: Passkey = {
				id: "1",
				name: "Test Passkey",
				publicKey: new Uint8Array([4, 5, 6]),
				algorithm: "ES256",
			};
			const store = new Store<PasskeyStoreState>({
				passkeys: [passkey],
			});
			const found = getPasskey({ store, id: "1" });
			expect(found).toEqual(passkey);
		});

		it("should return undefined for non-existent passkey", () => {
			const store = new Store<PasskeyStoreState>({
				passkeys: [],
			});
			const found = getPasskey({ store, id: "non-existent" });
			expect(found).toBeUndefined();
		});

		it("should clear passkeys", () => {
			const passkey: Passkey = {
				id: "1",
				name: "Test Passkey",
				publicKey: new Uint8Array([4, 5, 6]),
				algorithm: "ES256",
			};
			const store = new Store<PasskeyStoreState>({
				passkeys: [passkey],
			});
			clearPasskeys({ store });
			expect(store.state.passkeys).toHaveLength(0);
		});
	});
});
