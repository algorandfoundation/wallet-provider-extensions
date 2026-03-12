import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearKeyData,
	decryptWithKeyData,
	encryptWithKeyData,
} from "./crypto.ts";
import type { KeyData } from "./types/index.ts";

// Helpers
const makeUint8 = (arr: number[]) => new Uint8Array(arr);

describe("crypto.ts", () => {
	const origGetRandomValues = globalThis.crypto?.getRandomValues?.bind(
		globalThis.crypto,
	);

	beforeEach(() => {
		// deterministically stub webcrypto getRandomValues for generateId
		Object.defineProperty(globalThis, "crypto", {
			value: {
				...globalThis.crypto,
				getRandomValues: (buf: Uint8Array) => {
					for (let i = 0; i < buf.length; i++) buf[i] = i; // 00,01,02,...
					return buf;
				},
			},
			configurable: true,
		});
	});

	afterEach(() => {
		if (origGetRandomValues) {
			Object.defineProperty(globalThis, "crypto", {
				value: { ...globalThis.crypto, getRandomValues: origGetRandomValues },
				configurable: true,
			});
		}
	});

	it("clearKeyData removes privateKey field if present", () => {
		const key: Partial<KeyData> = { privateKey: makeUint8([5, 6, 7]) } as any;
		clearKeyData(key);
		expect(key.privateKey).toBeUndefined();
	});

	it("encryptWithKeyData + decryptWithKeyData roundtrip", async () => {
		const key: KeyData = {
			id: "k1",
				type: "ed25519",
			algorithm: "raw",
			extractable: false,
			publicKey: makeUint8([10, 11, 12]),
		};
		const plaintext = makeUint8([100, 101, 102]);

		const encrypted = await encryptWithKeyData({
			key: { ...key },
			data: plaintext,
		});
		// Expect nonce(24 bytes) + transformed ciphertext
		expect((encrypted as Uint8Array).length).toBe(24 + plaintext.length + 16);

		const decrypted = await decryptWithKeyData({
			key: { ...key },
			data: encrypted as Uint8Array,
		});
		expect(Array.from(decrypted as Uint8Array)).toEqual(Array.from(plaintext));
	});
});
