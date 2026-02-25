import type { Key } from "@algorandfoundation/keystore";
import { describe, expect, it, vi } from "vitest";
import { WithPasskeysKeystore } from "./extension.ts";

describe("WithPasskeysKeystore", () => {
	it("should populate passkeys from keystore keys in provider", async () => {
		const mockKeyId = "passkey-123";
		const mockKey: Partial<Key> = {
			id: mockKeyId,
			type: "hd-derived-passkey",
			publicKey: new Uint8Array([1, 2, 3]),
			algorithm: "ES256",
			metadata: { origin: "https://example.com", userHandle: "user-123" },
		};

		const mockAddPasskey = vi.fn();
		const provider = {
			keys: [mockKey],
			passkey: {
				store: {
					addPasskey: mockAddPasskey,
				},
			},
			key: {
				store: {
					hooks: {
						after: vi.fn(),
					},
				},
			},
		};

		const options = {
			passkeys: {
				store: {
					state: { passkeys: [] },
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: vi.fn(),
				},
			},
		};

		WithPasskeysKeystore(provider as any, options as any);

		expect(mockAddPasskey).toHaveBeenCalled();
		const addedPasskey = mockAddPasskey.mock.calls[0][0];
		expect(addedPasskey.id).toBe(mockKeyId);
		expect(addedPasskey.metadata.keyId).toBe(mockKeyId);
	});

	it("should subscribe to keystore updates and add new passkeys", async () => {
		const mockKey1: Partial<Key> = {
			id: "key-1",
			type: "hd-derived-ed25519",
		};
		const mockKey2: Partial<Key> = {
			id: "key-2",
			type: "hd-derived-passkey",
			publicKey: new Uint8Array([4, 5, 6]),
			metadata: { origin: "https://example.com" },
		};

		let subscribeCallback: (state: any) => void = () => {};
		const mockSubscribe = vi.fn((cb) => {
			subscribeCallback = cb;
		});

		const mockAddPasskey = vi.fn();
		const provider = {
			keys: [mockKey1],
			passkey: {
				store: {
					addPasskey: mockAddPasskey,
				},
			},
			key: {
				store: {
					hooks: {
						after: vi.fn(),
					},
				},
			},
		};

		const options = {
			passkeys: {
				store: {
					state: { passkeys: [] },
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: mockSubscribe,
				},
			},
		};

		WithPasskeysKeystore(provider as any, options as any);

		// Initial keys list in provider was [mockKey1], none were passkeys.
		expect(mockAddPasskey).not.toHaveBeenCalled();

		// Simulate new key added to keystore state
		subscribeCallback({
			keys: [mockKey1, mockKey2],
		});

		expect(mockAddPasskey).toHaveBeenCalledTimes(1);
		expect(mockAddPasskey.mock.calls[0][0].id).toBe("key-2");
	});

	it("should throw error if dependencies are missing", () => {
		const provider = {};
		const options = {
			passkeys: { store: {} },
			keystore: { store: {} },
		};

		expect(() => WithPasskeysKeystore(provider as any, options as any)).toThrow(
			"PasskeysKeystore extension requires WithPasskeyStore extension to be present on the provider.",
		);

		const providerWithPasskey = { passkey: { store: {} } };
		expect(() =>
			WithPasskeysKeystore(providerWithPasskey as any, options as any),
		).toThrow(
			"PasskeysKeystore extension requires WithKeyStore extension to be present on the provider.",
		);
	});
});
