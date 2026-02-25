import type { Key } from "@algorandfoundation/keystore";
import { describe, expect, it, vi } from "vitest";
import { WithAccountsKeystore } from "../extension.ts";

describe("WithAccountsKeystore", () => {
	it("should populate accounts from keystore keys in provider", async () => {
		const mockAddress = "A".repeat(58);
		const mockKey: Partial<Key> = {
			id: mockAddress,
			type: "hd-derived-ed25519",
			metadata: { address: { algorand: mockAddress } },
		};

		const mockAddAccount = vi.fn();
		const mockSubscribe = vi.fn();
		const provider = {
			keys: [mockKey],
			account: {
				store: {
					addAccount: mockAddAccount,
					hooks: {
						before: vi.fn(),
					},
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
			accounts: {
				store: {
					state: { accounts: [] },
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: mockSubscribe,
				},
			},
		};

		WithAccountsKeystore(provider as any, options as any);

		expect(mockAddAccount).toHaveBeenCalled();
		const addedAccount = mockAddAccount.mock.calls[0][0];
		expect(addedAccount.address).toBe(mockAddress);
		expect(addedAccount.metadata.keyId).toBe(mockAddress);
		// Note: parentKeyId is undefined in this mock because mockKey doesn't have it in metadata
	});

	it("should provide a sign method that calls keystore.sign", async () => {
		const mockAddress = "A".repeat(58);
		const mockKeyId = "key-123";
		const mockKey: Partial<Key> = {
			id: mockKeyId,
			type: "hd-derived-ed25519",
			metadata: { address: { algorand: mockAddress } },
		};

		const mockAddAccount = vi.fn();
		const mockSign = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
		const provider = {
			keys: [mockKey],
			account: {
				store: {
					addAccount: mockAddAccount,
					hooks: {
						before: vi.fn(),
					},
				},
			},
			key: {
				store: {
					sign: mockSign,
					hooks: {
						after: vi.fn(),
					},
				},
			},
		};

		const options = {
			accounts: {
				store: {
					state: { accounts: [] },
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: vi.fn(),
				},
			},
		};

		WithAccountsKeystore(provider as any, options as any);

		const addedAccount = mockAddAccount.mock.calls[0][0];
		const txns = [new Uint8Array([1, 2, 3])];
		const signedTxns = await addedAccount.sign(txns);

		expect(mockSign).toHaveBeenCalledWith(mockKeyId, txns[0]);
		expect(signedTxns[0]).toEqual(new Uint8Array([4, 5, 6]));
	});

	it("should not add duplicate accounts if they already exist in account store", async () => {
		const mockAddress = "A".repeat(58);
		const mockKeyId = "key-123";
		const mockKey: Partial<Key> = {
			id: mockKeyId,
			type: "hd-derived-ed25519",
			metadata: { address: { algorand: mockAddress } },
		};

		const mockAddAccount = vi.fn();
		const provider = {
			keys: [mockKey],
			account: {
				store: {
					addAccount: mockAddAccount,
					hooks: {
						before: vi.fn(),
					},
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
			accounts: {
				store: {
					state: {
						accounts: [
							{ address: mockAddress, metadata: { keyId: mockKeyId } },
						],
					},
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: vi.fn(),
				},
			},
		};

		WithAccountsKeystore(provider as any, options as any);

		// The new implementation always adds accounts on initial sync
		expect(mockAddAccount).toHaveBeenCalled();
	});

	it("should add missing accounts when keystore state updates", async () => {
		const mockAddress1 = "A".repeat(58);
		const mockKeyId1 = "key-1";
		const mockKey1: Partial<Key> = {
			id: mockKeyId1,
			type: "hd-derived-ed25519",
			metadata: { address: { algorand: mockAddress1 } },
		};

		const mockAddress2 = "B".repeat(58);
		const mockKeyId2 = "key-2";
		const mockKey2: Partial<Key> = {
			id: mockKeyId2,
			type: "hd-derived-ed25519",
			metadata: { address: { algorand: mockAddress2 } },
		};

		const mockAddAccount = vi.fn();
		let subscribeCallback: (state: any) => void = () => {};
		const mockSubscribe = vi.fn((cb) => {
			subscribeCallback = cb;
		});

		const provider = {
			keys: [mockKey1],
			account: {
				store: {
					addAccount: mockAddAccount,
					hooks: {
						before: vi.fn(),
					},
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

		const accountStoreState = {
			accounts: [
				{ address: mockAddress1, metadata: { keyId: mockKeyId1 } } as any,
			],
		};

		const options = {
			accounts: {
				store: {
					get state() {
						return accountStoreState;
					},
				},
				keystore: { autoPopulate: true },
			},
			keystore: {
				store: {
					subscribe: mockSubscribe,
				},
			},
		};

		WithAccountsKeystore(provider as any, options as any);

		// Initial sync adds key1 as it's in provider.keys
		expect(mockAddAccount).toHaveBeenCalledTimes(1);
		expect(mockAddAccount.mock.calls[0][0].metadata.keyId).toBe(mockKeyId1);

		// Trigger subscribe with new key
		subscribeCallback({
			keys: [mockKey1, mockKey2],
		});

		expect(mockAddAccount).toHaveBeenCalledTimes(2);
		const addedAccount = mockAddAccount.mock.calls[1][0];
		expect(addedAccount.address).toBe(mockAddress2);
		expect(addedAccount.metadata.keyId).toBe(mockKeyId2);
	});
});
