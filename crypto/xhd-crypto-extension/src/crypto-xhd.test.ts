import {
	BIP32DerivationType,
	XHDWalletAPI,
} from "@algorandfoundation/xhd-wallet-api";
import { describe, expect, it } from "vitest";
import { init } from "./crypto-xhd.js";

describe("XHD Crypto Extension", () => {
	const mockProvider = {
		crypto: { existing: "value" },
	} as any;

	it("should align with README usage", async () => {
		const provider = {
			crypto: {},
		} as any;

		const extension = init(provider, {});
		provider.crypto = extension.crypto;

		// Access the XHD API
		const xhdApi = provider.crypto.xhd;
		expect(xhdApi).toBeInstanceOf(XHDWalletAPI);

		// Access other crypto tools
		expect(provider.crypto.sha512_256).toBeDefined();
		expect(provider.crypto.base32).toBeDefined();
	});

	it("should preserve existing provider crypto", () => {
		const extension = init(mockProvider, {});
		expect((extension.crypto as any).existing).toBe("value");
	});

	it("should derive keys using XHDWalletAPI", async () => {
		const extension = init(mockProvider, {});
		const seed = new Uint8Array(32).fill(1);
		const key = await extension.crypto.xhd.deriveKey(
			seed,
			[],
			false,
			BIP32DerivationType.Peikert,
		);
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBeGreaterThan(0);
	});
});
