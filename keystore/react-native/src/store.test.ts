import type { KeyStoreState } from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

// Mock react-native-quick-crypto BEFORE any imports that use it
vi.mock("react-native-quick-crypto", () => ({
	subtle: {
		importKey: vi.fn().mockResolvedValue("mocked-key"),
		exportKey: vi.fn().mockResolvedValue(new Uint8Array(32).fill(255)),
	},
	createCipheriv: vi.fn(),
	createDecipheriv: vi.fn(),
	randomBytes: vi.fn(),
}));

// Mock other dependencies that rely on native modules or complex setups
vi.mock("./storage/state.ts", () => ({
	commit: vi.fn().mockResolvedValue(undefined),
	fetchSecret: vi.fn(),
	storage: {
		remove: vi.fn(),
		clearAll: vi.fn(),
	},
}));

vi.mock("@algorandfoundation/wallet-provider", () => ({
	generateId: vi.fn().mockReturnValue("test-id"),
	clearBuffer: vi.fn(),
}));

// Import the functions AFTER mocking
import { parsePath } from "./store.ts";
import { importKey, importSeed } from "./import.ts";
import { fetchSecret } from "./storage/state.ts";

describe("react-native-keystore store.ts logic", () => {
	describe("parsePath", () => {
		it("should parse a standard BIP44 path", () => {
			const path = "m/44'/283'/0'/0/0";
			const result = parsePath(path);
			expect(result).toEqual([
				0x80000000 + 44,
				0x80000000 + 283,
				0x80000000 + 0,
				0,
				0,
			]);
		});

		it("should handle paths without 'm/' prefix", () => {
			const path = "44'/283'/0'/0/1";
			const result = parsePath(path);
			expect(result).toEqual([
				0x80000000 + 44,
				0x80000000 + 283,
				0x80000000 + 0,
				0,
				1,
			]);
		});

		it("should handle mixed hardened and non-hardened parts", () => {
			const path = "m/44'/283/0'/1/2";
			const result = parsePath(path);
			expect(result).toEqual([0x80000000 + 44, 283, 0x80000000 + 0, 1, 2]);
		});
	});
});
