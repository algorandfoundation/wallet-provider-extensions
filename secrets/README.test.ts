import { Provider } from "@algorandfoundation/wallet-provider";

import { describe, expect, it } from "vitest";
import {
	withSecretStoreExtension,
} from "./src/index.js";

describe("Secret Store README Examples", () => {
	it("should run the 'Register the Extension' example", async () => {
		const MyProvider = Provider.withExtensions([withSecretStoreExtension]);
		const provider = new MyProvider({
			id: "my-provider",
			name: "My Wallet",
		}) as any;

		// 2. Use the secret API
		await provider.secret.add({
			id: "my-secret-1",
			name: "Main Account",
			type: "algo25",
			value: "...",
		});

		expect(provider.secrets).toHaveLength(1);
		expect(provider.secrets[0].id).toBe("my-secret-1");
	});
});
