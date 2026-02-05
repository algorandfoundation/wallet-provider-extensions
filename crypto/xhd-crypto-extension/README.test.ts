import { Provider } from "@algorandfoundation/wallet-provider";
import { describe, expect, it } from "vitest";
import WithXHDCryptoExtension from "./src/index.js";

describe("XHD Crypto Extension README Examples", () => {
	it("should run the 'Basic Initialization' and 'Usage' examples", async () => {
		const MyProvider = Provider.withExtensions([WithXHDCryptoExtension]);
		const provider = new MyProvider({
			id: "test-provider",
			name: "Test Provider",
		}) as any;

		// Access the XHD API
		const xhdApi = provider.crypto.xhd;
		expect(xhdApi).toBeDefined();

		// Generate a key (using a 96-byte extended root key)
		const rootKey = new Uint8Array(96).fill(1);
		const publicKey = await xhdApi.keyGen(
			rootKey,
			0, // KeyContext.Address
			0, // account
			0, // keyIndex
		);
		expect(publicKey).toBeDefined();

		// Use cryptographic primitives
		const hash = provider.crypto.sha512_256(new Uint8Array([1, 2, 3]));
		expect(hash).toBeDefined();

		const encoded = provider.crypto.base32.encode(new Uint8Array([1, 2, 3]));
		expect(encoded).toBeDefined();
		expect(typeof encoded).toBe("string");
	});
});
