import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock react-native-quick-crypto BEFORE any imports that use it
vi.mock("react-native-quick-crypto", () => ({
	subtle: {
		importKey: vi.fn().mockResolvedValue("mocked-key"),
		exportKey: vi.fn().mockResolvedValue(new Uint8Array(32).fill(255)),
	},
}));

// Mock other dependencies that rely on native modules or complex setups
const secrets = new Map();
vi.mock("./storage/state.ts", () => ({
	commit: vi.fn().mockImplementation(({ keyData }) => {
		secrets.set(keyData.id, keyData);
		return Promise.resolve();
	}),
	fetchSecret: vi.fn().mockImplementation(({ keyId }) => {
		return Promise.resolve(secrets.get(keyId));
	}),
	storage: {
		remove: vi.fn(),
		clearAll: vi.fn(),
	},
}));

vi.mock("@algorandfoundation/wallet-provider", () => ({
	generateId: vi.fn().mockReturnValue("test-id"),
	clearBuffer: vi.fn(),
}));

import {
	InvalidKeyDataError,
	InvalidKeyFormatError,
	type KeyStoreState,
} from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
// Import the functions AFTER mocking
import { importKey, importSeed } from "./import.ts";

describe("react-native-keystore import.ts logic", () => {
	describe("importSeed", () => {
		const store = new Store<KeyStoreState>({ keys: [], status: "idle" });

		beforeEach(async () => {
			const { commit } = await import("./storage/state.ts");
			(commit as any).mockClear();
			store.setState({ keys: [], status: "idle" });
		});

		it("should import a BIP39 mnemonic string", async () => {
			const mnemonic =
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
			const id = await importSeed({
				store,
				seed: mnemonic,
				algorithm: "bip39",
			});

			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			expect(commit).toHaveBeenCalledWith(
				expect.objectContaining({
					keyData: expect.objectContaining({
						type: "hd-seed",
						algorithm: "bip39",
					}),
				}),
			);
		});

		it("should import a raw Uint8Array seed and use provided id", async () => {
			const rawSeed = new Uint8Array(64).fill(1);
			const id = await importSeed({
				store,
				seed: rawSeed,
				name: "Raw Seed",
				id: "provided-id",
			});

			expect(id).toBe("provided-id");
			const { commit } = await import("./storage/state.ts");
			expect(commit).toHaveBeenCalledWith(
				expect.objectContaining({
					keyData: expect.objectContaining({
						id: "provided-id",
						type: "hd-seed",
						privateKey: rawSeed,
						name: "Raw Seed",
					}),
				}),
			);
		});

		it("should import raw base64 seed via importSeed", async () => {
			const seed = "SGVsbG8gV29ybGQ="; // "Hello World" in base64
			const id = await importSeed({
				store,
				seed,
				algorithm: "raw",
				format: "base64",
			});
			expect(id).toBe("test-id");
		});

		it("should import BIP39 entropy via importSeed", async () => {
			const entropy = new Uint8Array(16).fill(0);
			const id = await importSeed({
				store,
				seed: { entropy },
				algorithm: "bip39",
			});
			expect(id).toBe("test-id");
		});

		it("should import Algo25 mnemonic via importSeed", async () => {
			// A valid 25-word Algorand mnemonic
			const mnemonic =
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon invest";
			const id = await importSeed({
				store,
				seed: mnemonic,
				algorithm: "algo25",
			});
			expect(id).toBe("test-id");

			const { commit } = await import("./storage/state.ts");
			expect(commit).toHaveBeenCalledWith(
				expect.objectContaining({
					keyData: expect.objectContaining({
						type: "hd-seed",
						algorithm: "algo25",
					}),
				}),
			);
		});

		it("should import Algo25 raw seed via importSeed", async () => {
			const rawSeed = new Uint8Array(32).fill(2);
			const id = await importSeed({
				store,
				seed: rawSeed,
				algorithm: "algo25",
			});
			expect(id).toBe("test-id");
		});

		it("should throw for invalid raw seed type", async () => {
			await expect(
				importSeed({
					store,
					seed: 123 as any,
					algorithm: "raw",
				}),
			).rejects.toThrow(InvalidKeyDataError);
		});

		it("should throw for invalid BIP39 seed type", async () => {
			await expect(
				importSeed({
					store,
					seed: 123 as any,
					algorithm: "bip39",
				}),
			).rejects.toThrow(InvalidKeyDataError);
		});

		it("should throw for invalid Algo25 seed type", async () => {
			await expect(
				importSeed({
					store,
					seed: { entropy: new Uint8Array(16) } as any,
					algorithm: "algo25",
				}),
			).rejects.toThrow(InvalidKeyDataError);
		});

		it("should throw for unsupported algorithm", async () => {
			await expect(
				importSeed({
					store,
					seed: new Uint8Array(32),
					algorithm: "unsupported" as any,
				}),
			).rejects.toThrow(InvalidKeyDataError);
		});
	});

	describe("importKey", () => {
		const store = new Store<KeyStoreState>({ keys: [], status: "idle" });

		beforeEach(async () => {
			const { commit } = await import("./storage/state.ts");
			(commit as any).mockClear();
			store.setState({ keys: [], status: "idle" });
		});

		it("should throw for raw Uint8Array if algorithm is missing", async () => {
			const raw = new Uint8Array(32);
			await expect(importKey({ store, keyData: raw })).rejects.toThrow(
				"Algorithm must be specified",
			);
		});

		it("should throw for raw Uint8Array if format is not raw", async () => {
			const raw = new Uint8Array(32);
			await expect(
				importKey({
					store,
					keyData: raw,
					algorithm: "unsupported" as any,
					format: "unsupported" as any,
				}),
			).rejects.toThrow("If format is specified, it must be 'raw'");
		});

		it("should throw for string as first argument without algorithm", async () => {
			const mnemonic =
				"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
			await expect(importKey({ store, keyData: mnemonic })).rejects.toThrow(
				InvalidKeyFormatError,
			);
		});

		it("should import ed25519 key from raw Uint8Array (32 bytes)", async () => {
			const raw = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: raw,
				algorithm: "ed25519",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			expect(commit).toHaveBeenCalledWith(
				expect.objectContaining({
					keyData: expect.objectContaining({
						type: "ed25519",
						privateKey: expect.any(Uint8Array),
						publicKey: expect.any(Uint8Array),
					}),
				}),
			);
			// Verify private key is combined (64 bytes)
			const lastCall = (commit as any).mock.calls.at(-1)[0];
			expect(lastCall.keyData.privateKey.length).toBe(64);
			expect(lastCall.keyData.metadata.parentKeyId).toBeDefined();
		});

		it("should import ed25519 key and save seed as parentKeyId with provided id", async () => {
			const raw = new Uint8Array(32).fill(2);
			const id = await importKey({
				store,
				keyData: Object.assign(new Uint8Array(raw), { id: "provided-key-id" }),
				algorithm: "ed25519",
			});
			expect(id).toBe("provided-key-id");
			const { commit } = await import("./storage/state.ts");

			// Should have been called twice: once for seed, once for key
			expect(commit).toHaveBeenCalledTimes(2);

			const seedCall = (commit as any).mock.calls.at(-2)[0];
			expect(seedCall.keyData.type).toBe("hd-seed");
			expect(seedCall.keyData.id).toBe("provided-key-id"); // Seed currently gets the same ID if provided on bytes
			expect(new Uint8Array(seedCall.keyData.privateKey)).toEqual(raw);

			const keyCall = (commit as any).mock.calls.at(-1)[0];
			expect(keyCall.keyData.type).toBe("ed25519");
			expect(keyCall.keyData.id).toBe("provided-key-id");
			expect(keyCall.keyData.metadata.parentKeyId).toBe(seedCall.keyData.id);
		});

		it("should import ed25519 key from combined Uint8Array (64 bytes)", async () => {
			const combined = new Uint8Array(64).fill(1);
			const id = await importKey({
				store,
				keyData: combined,
				algorithm: "ed25519",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			const lastCall = (commit as any).mock.calls.at(-1)[0];
			expect(lastCall.keyData.privateKey).toEqual(combined);
			expect(lastCall.keyData.publicKey).toEqual(combined.slice(32));
		});

		it("should import ed25519 key from raw bytes (reproducing issue)", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "ed25519" as any,
				format: "raw",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			const lastCall = (commit as any).mock.calls.at(-1)[0];
			expect(lastCall.keyData.type).toBe("ed25519");
		});

		it("should throw for ed25519 with invalid length", async () => {
			const invalid = new Uint8Array(31);
			await expect(
				importKey({
					store,
					keyData: invalid,
					algorithm: "ed25519",
				}),
			).rejects.toThrow(InvalidKeyDataError);
		});

		it("should throw for unknown key type in KeyData object", async () => {
			const keyData = {
				type: "unknown" as any,
			};
			await expect(importKey({ store, keyData })).rejects.toThrow(
				InvalidKeyDataError,
			);
		});

		it("should import hd-derived-ed25519 via importKey", async () => {
			const keyData = {
				id: "provided-id",
				type: "hd-derived-ed25519" as const,
				publicKey: new Uint8Array(32).fill(1),
				metadata: { rootKeyId: "root-id" },
			};
			const id = await importKey({ store, keyData: keyData as any });
			expect(id).toBe("provided-id");
		});

		it("should throw for hd-derived-ed25519 without public key or private key", async () => {
			const keyData = {
				id: "provided-id",
				type: "hd-derived-ed25519" as const,
				metadata: { rootKeyId: "root-id" },
			};
			// It fails because it checks isHD && !seed?.privateKey first, but wait
			// In importEd25519Key:
			// const isHD = keyData.publicKey === undefined && keyData.privateKey === undefined;
			// ...
			// if (!isHD && !publicKey) { throw "Could not derive public key" }
			// if (isHD && typeof seed?.privateKey === "undefined") { throw "XHD derived keys require a seed" }
			await expect(
				importKey({ store, keyData: keyData as any }),
			).rejects.toThrow("XHD derived keys require a seed");
		});

		it("should support 'seed' format for ed25519 import", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "ed25519",
				format: "seed",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			// Twice: seed and key
			expect(commit).toHaveBeenCalledTimes(2);
			const seedCall = (commit as any).mock.calls.at(-2)[0];
			expect(seedCall.keyData.type).toBe("hd-seed");
		});

		it("should support 'xhd-root-key' algorithm for raw import", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "xhd-root-key",
				format: "raw",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			const lastCall = (commit as any).mock.calls.at(-1)[0];
			expect(lastCall.keyData.type).toBe("hd-root-key");
			expect(lastCall.keyData.name).toBe("Imported Root Key");
			expect(lastCall.keyData.privateKey.length).toBe(96);
		});

		it("should support 'xhd-derived-ed25519' algorithm for raw import", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "xhd-derived-ed25519",
				format: "raw",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			// Twice: root key and derived key
			expect(commit).toHaveBeenCalledTimes(2);
			const rootCall = (commit as any).mock.calls.at(-2)[0];
			expect(rootCall.keyData.type).toBe("hd-root-key");
			const keyCall = (commit as any).mock.calls.at(-1)[0];
			expect(keyCall.keyData.type).toBe("hd-derived-ed25519");
		});

		it("should support 'xhd-derived-ed25519' algorithm for seed format", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "xhd-derived-ed25519",
				format: "seed",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			// Three times: seed, root key, derived key
			expect(commit).toHaveBeenCalledTimes(3);
			const seedCall = (commit as any).mock.calls.at(-3)[0];
			expect(seedCall.keyData.type).toBe("hd-seed");
			const rootCall = (commit as any).mock.calls.at(-2)[0];
			expect(rootCall.keyData.type).toBe("hd-root-key");
			expect(rootCall.keyData.metadata.parentKeyId).toBe(seedCall.keyData.id);
			const keyCall = (commit as any).mock.calls.at(-1)[0];
			expect(keyCall.keyData.type).toBe("hd-derived-ed25519");
			expect(keyCall.keyData.metadata.parentKeyId).toBe(rootCall.keyData.id);
		});
		it("should support 'xhd-root-key' algorithm for seed format", async () => {
			const bytes = new Uint8Array(32).fill(1);
			const id = await importKey({
				store,
				keyData: bytes,
				algorithm: "xhd-root-key",
				format: "seed",
			});
			expect(id).toBe("test-id");
			const { commit } = await import("./storage/state.ts");
			// Twice: seed and root key
			expect(commit).toHaveBeenCalledTimes(2);
			const seedCall = (commit as any).mock.calls.at(-2)[0];
			expect(seedCall.keyData.type).toBe("hd-seed");
			const rootCall = (commit as any).mock.calls.at(-1)[0];
			expect(rootCall.keyData.type).toBe("hd-root-key");
			expect(rootCall.keyData.metadata.parentKeyId).toBe(seedCall.keyData.id);
		});
	});
});
