import type { SecretKey } from "@algorandfoundation/keystore-extension";
import { describe, expect, it } from "vitest";
import {
	cryptoBIP39Extension,
	MISSING_KEYSTORE_ERROR,
} from "./crypto-bip-39.js";

describe("BIP39 Crypto Extension", () => {
	const mockProvider = {
		crypto: {},
	} as any;

	it("should throw error when keystore is missing and calling keystore-dependent methods", async () => {
		const extension = cryptoBIP39Extension(mockProvider, { keystore: true });

		expect(extension.crypto.bip39.add!()).rejects.toThrow(
			MISSING_KEYSTORE_ERROR,
		);
		expect(extension.crypto.bip39.remove!("any-id")).rejects.toThrow(
			MISSING_KEYSTORE_ERROR,
		);
		expect(extension.crypto.bip39.import!({ mnemonic: "..." })).rejects.toThrow(
			MISSING_KEYSTORE_ERROR,
		);
		expect(extension.crypto.bip39.export!("any-id")).rejects.toThrow(
			MISSING_KEYSTORE_ERROR,
		);
	});

	it("should generate a mnemonic without a keystore", async () => {
		const extension = cryptoBIP39Extension(mockProvider, { keystore: false });
		const secret = await extension.crypto.bip39.generate({ strength: 256 });

		expect(secret.type).toBe("bip39");
		expect(secret.value?.split(" ")).toHaveLength(24); // 256 strength -> 24 words
	});

	it("should align with README usage", async () => {
		const secrets: SecretKey[] = [];
		const mockKeystore = {
			add: async (key: SecretKey) => {
				secrets.push(key);
				return key;
			},
			remove: async (id: string) => {
				const index = secrets.findIndex((s) => s.id === id);
				if (index > -1) secrets.splice(index, 1);
			},
			import: async (key: SecretKey) => {
				secrets.push(key);
				return key;
			},
			export: async (id: string) => {
				const key = secrets.find((s) => s.id === id);
				if (!key) throw new Error("Not found");
				return key;
			},
		};

		const provider = {
			crypto: {},
			keystore: mockKeystore,
		} as any;

		const extension = cryptoBIP39Extension(provider, { keystore: true });
		provider.crypto = extension.crypto;

		// 1. Basic Initialization (simplified)
		const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });
		expect(mnemonic.value?.split(" ")).toHaveLength(24);

		// 2. Integration with Keystore
		const secret = await provider.crypto.bip39.add({
			name: "My Recovery Phrase",
		});
		expect(secret.name).toBe("My Recovery Phrase");

		await provider.crypto.bip39.import({
			mnemonic:
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
			name: "Imported Account",
		});

		expect(secrets).toHaveLength(2);
		await provider.crypto.bip39.remove(secret.id);
		expect(secrets).toHaveLength(1);
	});
});
