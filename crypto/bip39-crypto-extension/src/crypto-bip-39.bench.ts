import * as bip39 from "@scure/bip39";
import { wordlist as englishWordList } from "@scure/bip39/wordlists/english.js";
import { bench, describe } from "vitest";
import { generateSecretKey } from "./crypto-bip-39.js";

describe("BIP39 Crypto Benchmarks", () => {
	bench("generateSecretKey (256 bits)", () => {
		generateSecretKey({ strength: 256 });
	});

	bench("generateSecretKey (128 bits)", () => {
		generateSecretKey({ strength: 128 });
	});

	const mnemonic = bip39.generateMnemonic(englishWordList, 256);
	bench("validateMnemonic", () => {
		bip39.validateMnemonic(mnemonic, englishWordList);
	});
});
