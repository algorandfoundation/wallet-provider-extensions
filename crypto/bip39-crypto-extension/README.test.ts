import { addSecret } from "@algorandfoundation/keystore-extension";
import type { Extension } from "@algorandfoundation/wallet-provider";
import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import WithBip39CryptoExtension, { cryptoBip39Hooks } from "./src/index.js";

const WithKeystoreExtension: Extension<any> = (provider) => {
	const store = new Store({ secrets: [] });
	Object.defineProperty(provider, "secrets", {
		get() {
			return store.state.secrets;
		},
		configurable: true,
		enumerable: true,
	});
	return {
		keystore: {
			add: async (key: any) => {
				//@ts-expect-error, this is a loosely typed extension
				addSecret(store, key);
				return key;
			},
			remove: async (id: string) => {
				store.setState((s) => ({
					//@ts-expect-error, this is a loosely typed extension
					secrets: s.secrets.filter((k) => k.id !== id),
				}));
			},
			import: async (key: any) => {
				//@ts-expect-error, this is a loosely typed extension
				addSecret(store, key);
				return key;
			},
			export: async (id: string) => {
				//@ts-expect-error, this is a loosely typed extension
				return store.state.secrets.find((k) => k.id === id);
			},
		},
	};
};

describe("BIP-39 Crypto Extension README Examples", () => {
	it("should run the 'Basic Initialization' example", async () => {
		const MyProvider = Provider.withExtensions([WithBip39CryptoExtension]);
		const provider = new MyProvider({
			id: "test-provider",
			name: "Test Provider",
		}) as any;

		// Access the BIP-39 API
		const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });
		expect(mnemonic.value).toBeDefined();
		expect(mnemonic.value.split(" ")).toHaveLength(24);
	});

	it("should run the 'Integration with Keystore' example", async () => {
		// In a real scenario, WithKeystoreExtension would be a real extension
		// For testing the README example literally:
		const MyProvider = Provider.withExtensions([
			WithKeystoreExtension,
			WithBip39CryptoExtension,
		]);
		const provider = new MyProvider(
			{
				id: "test-provider",
				name: "Test Provider",
			},
			{
				keystore: true, // Enable keystore in BIP39 extension
			},
		) as any;

		// Generate and add to keystore
		const secret = await provider.crypto.bip39.add({
			name: "My Recovery Phrase",
		});
		expect(secret.name).toBe("My Recovery Phrase");

		// Import an existing mnemonic
		await provider.crypto.bip39.import({
			mnemonic:
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
			name: "Imported Account",
		});

		// List and remove
		const mySecrets = provider.secrets;
		expect(mySecrets).toHaveLength(2);

		await provider.crypto.bip39.remove(secret.id);
		expect(provider.secrets).toHaveLength(1);
	});

	it("should run the 'Lifecycle Hooks' example", async () => {
		const logs: string[] = [];

		// Log before a mnemonic is generated
		cryptoBip39Hooks.before("generate", (options) => {
			logs.push(
				`Generating a new mnemonic with options: ${JSON.stringify(options)}`,
			);
		});

		// Audit after a mnemonic is imported
		cryptoBip39Hooks.after("import", (result) => {
			logs.push(`Mnemonic imported successfully with ID: ${result.id}`);
		});

		const MyProvider = Provider.withExtensions([
			WithKeystoreExtension,
			WithBip39CryptoExtension,
		]);
		const provider = new MyProvider(
			{
				id: "test-provider",
				name: "Test Provider",
			},
			{
				keystore: true,
			},
		) as any;

		await provider.crypto.bip39.generate({ strength: 128 });
		await provider.crypto.bip39.import({
			mnemonic:
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
			name: "Imported Account",
		});

		expect(logs).toContain(
			'Generating a new mnemonic with options: {"strength":128}',
		);
		expect(
			logs.some((l) => l.startsWith("Mnemonic imported successfully with ID:")),
		).toBe(true);
	});
});
