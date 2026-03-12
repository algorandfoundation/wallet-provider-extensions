import * as Keychain from "react-native-keychain";
import { describe, expect, it, vi } from "vitest";
import { decryptData, encryptData, getMasterKey } from "./crypto.ts";

describe("crypto storage", () => {
	it("should retrieve or generate a master key", async () => {
		const key = await getMasterKey();
		expect(key).toBeInstanceOf(Buffer);
		expect(key.length).toBe(32);
	});

	it("should encrypt and decrypt data", () => {
		const key = Buffer.alloc(32, 1);
		const data = "secret-message";
		const encrypted = encryptData(key, data);
		const decrypted = decryptData(key, encrypted);
		expect(decrypted).toBe(data);
	});

	it("should use stored key if available", async () => {
		const storedKey = Buffer.alloc(32, 2).toString("hex");
		vi.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
			password: storedKey,
			username: "master",
			service: "app-secret",
			storage: "best",
		});

		const key = await getMasterKey();
		expect(key.toString("hex")).toBe(storedKey);
	});
});
