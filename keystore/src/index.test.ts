import { format } from "node:url";
import {
	type SecretStoreExtension,
	withSecretStoreExtension,
} from "@algorandfoundation/secret-store";
// Framework Bits
import { type Extension, Provider } from "@algorandfoundation/wallet-provider";
import { base64url } from "@scure/base";
import { beforeEach, describe, expect, it } from "vitest";
// Concrete Bits
import { withKeyStoreExtension } from "./extension.ts";
import type { Key, KeyStoreExtension } from "./types.ts";

describe("KeyStoreBackend Conformance Tests", () => {
	let ext: Provider<
		[Extension<SecretStoreExtension>, Extension<KeyStoreExtension>]
	> &
		SecretStoreExtension &
		KeyStoreExtension;

	beforeEach(() => {
		const CustomProvider = Provider.withExtensions([
			withSecretStoreExtension,
			withKeyStoreExtension,
		]);
		ext = new CustomProvider({ id: "abc", name: "test" }) as any;
	});

	async function createTestKey(index = 0) {
		const mnemonic =
			"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
		await ext.secret.add({
			id: "seed-mn",
			name: "test-seed",
			type: "bip39",
			value: mnemonic,
		} as any);
		await ext.keystore.deriveFromSeed("seed-mn", `m/44'/283'/0'/0'/${index}'`, {
			type: "xhd-derived",
			algorithm: "EdDSA",
			curve: "ed25519",
		});
		return ext.keys[0]!.id;
	}

	// =======================
	// Core Operations
	// =======================
	describe("Core Operations", () => {
		describe("list()", () => {
			it("should return an array", async () => {
				const list = ext.keys;
				expect(Array.isArray(list)).toBe(true);
			});

			it("should include derived keys in the list", async () => {
				const id = await createTestKey();
				const list = ext.keys;
				const found = list.find((k) => k.id === id);
				expect(found).toBeDefined();
			});
		});

		describe("getMetadata()", () => {
			it("should return metadata for a derived key", async () => {
				const id = await createTestKey();
				const key = await ext.keystore.export(id);
				expect(key.id).toBe(id);
				expect(key.type).toBe("xhd-derived");
				expect(key.algorithm).toBe("EdDSA");
				expect(key.metadata.createdAt).toBeInstanceOf(Date);
			});
		});

		describe("export()", () => {
			it("should export a key with publicKey and metadata", async () => {
				const id = await createTestKey();
				const data = await ext.keystore.export(id);
				expect(data.publicKey).toBeInstanceOf(Uint8Array);
				expect(data.publicKey?.length).toBe(32);
				expect(data.metadata).toBeDefined();
				expect(data.id).toBe(id);
			});
		});

		describe("remove()", () => {
			it("should remove a key", async () => {
				const id = await createTestKey();
				await ext.keystore.remove(id);
				const list = ext.keys;
				const found = list.find((k) => k.id === id);
				expect(found).toBeUndefined();
			});
		});

		describe("import()", () => {
			it("should import a key and return a KeyId", async () => {
				const id = await createTestKey();
				const exported = await ext.keystore.export(id);
				const key = await ext.keystore.import(exported, "na");
				expect(typeof key.id).toBe("string");
				expect(key.id.length).toBeGreaterThan(0);
			});
		});
	});

	// =======================
	// Signing and Verification
	// =======================
	describe("Signing Operations", () => {
		describe("sign()", () => {
			it("should return a signature as Uint8Array", async () => {
				const id = await createTestKey();
				const data = new Uint8Array([1, 2, 3, 4, 5]);
				const signature = await ext.keystore.sign(id, data);
				expect(signature).toBeInstanceOf(Uint8Array);
				expect(signature.length).toBe(64);
			});

			it("should produce different signatures for different data", async () => {
				const id = await createTestKey();
				const sig1 = await ext.keystore.sign(id, new Uint8Array([1, 2, 3]));
				const sig2 = await ext.keystore.sign(id, new Uint8Array([4, 5, 6]));
				expect(sig1).not.toEqual(sig2);
			});

			it("should produce consistent signatures for same data (deterministic)", async () => {
				const id = await createTestKey();
				const data = new Uint8Array([1, 2, 3]);
				const sig1 = await ext.keystore.sign(id, data);
				const sig2 = await ext.keystore.sign(id, data);
				expect(sig1).toEqual(sig2);
			});
		});

		describe("verify()", () => {
			it("should verify a valid signature", async () => {
				const id = await createTestKey();
				const data = new Uint8Array([1, 2, 3, 4, 5]);
				const signature = await ext.keystore.sign(id, data);
				const valid = await ext.keystore.verify(id, data, signature);
				expect(valid).toBe(true);
			});

			it("should reject an invalid signature", async () => {
				const id = await createTestKey();
				const data = new Uint8Array([1, 2, 3, 4, 5]);
				const badSignature = new Uint8Array(64).fill(0);
				const valid = await ext.keystore.verify(id, data, badSignature);
				expect(valid).toBe(false);
			});

			it("should reject signature for different data", async () => {
				const id = await createTestKey();
				const data1 = new Uint8Array([1, 2, 3]);
				const data2 = new Uint8Array([4, 5, 6]);
				const signature = await ext.keystore.sign(id, data1);
				const valid = await ext.keystore.verify(id, data2, signature);
				expect(valid).toBe(false);
			});
		});

		// Optional batch signing test - only run if batchSign is implemented
		// This is a more advanced feature and may not be supported by all ext.keystores, so we allow it to be skipped via options
		describe("batchSign()", () => {
			it("should sign multiple data items", async () => {
				if (!ext.keystore.batchSign) return;

				const id1 = await createTestKey(0);
				const id2 = await createTestKey(1);

				const signatures = await ext.keystore.batchSign(
					[id1, id2],
					[new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
				);

				expect(Array.isArray(signatures)).toBe(true);
				expect(signatures.length).toBe(2);
				for (const sig of signatures) {
					expect(sig).toBeInstanceOf(Uint8Array);
					expect(sig.length).toBe(64);
				}
			});
		});
	});

	// =======================
	// Optional Advanced Features
	//
	//
	// xHD Wallet Operations (importSeed, deriveFromSeed)
	//
	// =======================

	describe("HD Wallet Operations", () => {
		describe("importSeed()", () => {
			it("should import a seed and return a KeyId", async () => {
				if (!ext.keystore.importSeed) return;

				const id = await ext.keystore.importSeed(
					{
						type: "raw",
						value: base64url.encode(new Uint8Array(64).fill(1)),
					} as any,
					{
						id: "test-key-1",
						type: "xhd-derived",
						algorithm: "EdDSA",
						metadata: {},
					} as Key,
				);
				expect(typeof id).toBe("string");
				expect(id.length).toBeGreaterThan(0);
			});
		});

		describe("deriveFromSeed()", () => {
			it("should derive a key from seed", async () => {
				if (!ext.keystore.importSeed || !ext.keystore.deriveFromSeed) return;

				const mnemonic =
					"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
				await ext.secret.add({
					id: "seed-der-1",
					name: "seed-der-1",
					type: "bip39",
					value: mnemonic,
				} as any);
				const seedRef = ext.secrets[0]!.id;
				await ext.keystore.deriveFromSeed(seedRef, "m/44'/283'/0'/0'/0'", {
					type: "xhd-derived",
					algorithm: "EdDSA",
					curve: "ed25519",
				});
				const derivedId = ext.keys[0]!.id;
				expect(typeof derivedId).toBe("string");
				expect(derivedId.length).toBeGreaterThan(0);
			});

			it("should derive different keys for different paths", async () => {
				if (!ext.keystore.importSeed || !ext.keystore.deriveFromSeed) return;

				const mnemonic =
					"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
				await ext.secret.add({
					id: "seed-der-2",
					name: "seed-der-2",
					type: "bip39",
					value: mnemonic,
				} as any);

				const seedRef = ext.secrets[0]!.id;
				await ext.keystore.deriveFromSeed(seedRef, "m/44'/283'/0'/0'/0'", {
					type: "xhd-derived",
					algorithm: "EdDSA",
					curve: "ed25519",
				});
				const id1 = ext.keys[0]!.id;
				await ext.keystore.deriveFromSeed(seedRef, "m/44'/283'/0'/0'/1'", {
					type: "xhd-derived",
					algorithm: "EdDSA",
					curve: "ed25519",
				});

				const id2 = ext.keys[0]!.id;

				const key1 = await ext.keystore.export(id1);
				const key2 = await ext.keystore.export(id2);

				expect(key1.publicKey).not.toEqual(key2.publicKey);
			});

			it("should derive same key for same path (deterministic)", async () => {
				if (!ext.keystore.importSeed || !ext.keystore.deriveFromSeed) return;

				const mnemonic =
					"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
				await ext.secret.add({
					id: "seed-der-3",
					name: "seed-der-3",
					type: "bip39",
					value: mnemonic,
				} as any);
				const path = "m/44'/283'/0'/0'/0'";

				const seedRef = ext.secrets[0]!.id;
				await ext.keystore.deriveFromSeed(seedRef, path, {
					type: "xhd-derived",
					algorithm: "EdDSA",
					curve: "ed25519",
				});
				const id1 = ext.keys[0]!.id;
				await ext.keystore.deriveFromSeed(seedRef, path, {
					type: "xhd-derived",
					algorithm: "EdDSA",
					curve: "ed25519",
				});

				const id2 = ext.keys[0]!.id;

				const key1 = await ext.keystore.export(id1);
				const key2 = await ext.keystore.export(id2);

				expect(key1.publicKey).toEqual(key2.publicKey);
			});
		});
	});

	// =======================
	// Encryption with Passphrase and Key Agreement (encryptWithKey, encryptData, deriveSharedSecret)
	// =======================

	describe("Encryption Operations", () => {
		describe("encryptWithKey() / decryptWithKey()", () => {
			it("should round-trip encrypt/decrypt data", async () => {
				if (!ext.keystore.encryptWithKey || !ext.keystore.decryptWithKey)
					return;

				const id = await createTestKey();
				const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
				const encrypted = await ext.keystore.encryptWithKey(id, plaintext);
				const decrypted = await ext.keystore.decryptWithKey(id, encrypted);
				expect(decrypted).toEqual(plaintext);
			});
		});

		describe("encryptData() / decryptData()", () => {
			it("should round-trip encrypt/decrypt with passphrase", async () => {
				if (!ext.keystore.encryptData || !ext.keystore.decryptData) return;

				const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
				const passphrase = "test-password";
				const encrypted = await ext.keystore.encryptData(plaintext, passphrase);
				const decrypted = await ext.keystore.decryptData(encrypted, passphrase);
				expect(decrypted).toEqual(plaintext);
			});
		});

		describe("deriveSharedSecret()", () => {
			it("should derive a shared secret", async () => {
				if (!ext.keystore.deriveSharedSecret) return;

				const id1 = await createTestKey(0);
				const id2 = await createTestKey(1);

				const key2 = await ext.keystore.export(id2);
				if (!key2.publicKey) throw new Error("publicKey missing");
				const secret = await ext.keystore.deriveSharedSecret(
					id1,
					key2.publicKey,
				);

				expect(secret).toBeInstanceOf(Uint8Array);
			});

			it("should derive same secret from both sides", async () => {
				if (!ext.keystore.deriveSharedSecret) return;

				const id1 = await createTestKey(0);
				const id2 = await createTestKey(1);

				const key1 = await ext.keystore.export(id1);
				const key2 = await ext.keystore.export(id2);
				if (!key1.publicKey || !key2.publicKey)
					throw new Error("publicKey missing");

				const secret1 = await ext.keystore.deriveSharedSecret(
					id1,
					key2.publicKey,
				);
				const secret2 = await ext.keystore.deriveSharedSecret(
					id2,
					key1.publicKey,
				);

				expect(secret1).toEqual(secret2);
			});
		});
	});

	// =======================
	// Audit Logging (logAuditEvent, getAuditLogs)
	//
	// Optional features, but gives the option to logs or persistent audit trails of key operations which can be important for security-sensitive applications
	// =======================

	// TODO: implement log extension

	describe.skip("Audit Operations", () => {
		describe("logAuditEvent() / getAuditLogs()", () => {
			it("should log and retrieve audit events", async () => {
				if (!ext.keystore.logAuditEvent || !ext.keystore.getAuditLogs) return;

				const event = {
					id: "test-event-1",
					timestamp: new Date(),
					operation: "sign",
					keyId: "test-key",
					success: true,
				};

				await ext.keystore.logAuditEvent(event);
				const logs = await ext.keystore.getAuditLogs();

				expect(Array.isArray(logs)).toBe(true);
				const found = logs.find((e) => e.id === event.id);
				expect(found).toBeDefined();
				expect(found?.operation).toBe("sign");
			});

			it("should filter audit logs by operation", async () => {
				if (!ext.keystore.logAuditEvent || !ext.keystore.getAuditLogs) return;

				await ext.keystore.logAuditEvent({
					id: "event-sign",
					timestamp: new Date(),
					operation: "sign",
					success: true,
				});
				await ext.keystore.logAuditEvent({
					id: "event-verify",
					timestamp: new Date(),
					operation: "verify",
					success: true,
				});

				const logs = await ext.keystore.getAuditLogs({ operation: "sign" });
				expect(logs.every((e) => e.operation === "sign")).toBe(true);
			});
		});
	});

	// =======================
	// Error Handling
	//
	// Tests to ensure that the ext.keystore properly throws errors for invalid operations, such as trying to access non-existent keys or providing invalid input data. Proper error handling is crucial for robustness and security.
	// =======================

	describe("Error Handling", () => {
		it("should throw when exporting non-existent key", async () => {
			await expect(
				ext.keystore.export("non-existent-key-id"),
			).rejects.toThrow();
		});

		it("should throw when signing with non-existent key", async () => {
			await expect(
				ext.keystore.sign("non-existent-key-id", new Uint8Array([1, 2, 3])),
			).rejects.toThrow();
		});
	});
});
