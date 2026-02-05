import { BIP32DerivationType } from "@algorandfoundation/xhd-wallet-api";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { bench, describe } from "vitest";
import { init } from "./crypto-xhd.js";

describe("XHD Crypto Benchmarks", () => {
	const mockProvider = { crypto: {} } as any;
	const extension = init(mockProvider, {});
	const seed = new Uint8Array(32).fill(1);
	const data = new Uint8Array(1024).fill(0);

	bench("deriveKey", async () => {
		await extension.crypto.xhd.deriveKey(
			seed,
			[],
			undefined,
			BIP32DerivationType.Peikert,
		);
	});

	bench("sha512_256 (1KB)", () => {
		sha512_256(data);
	});
});
