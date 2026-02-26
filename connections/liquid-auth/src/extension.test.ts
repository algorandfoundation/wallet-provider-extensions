import { WithAccountStore } from "@algorandfoundation/accounts-store";
import { WithConnectionStore } from "@algorandfoundation/connections-store";
import { WithPasskeyStore } from "@algorandfoundation/passkey-store";
import { Provider } from "@algorandfoundation/wallet-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithLiquidAuth } from "./extension.js";

// Mock SignalClient
const mockSignalClient = {
	link: vi.fn(() =>
		Promise.resolve({
			requestId: "test-request-id",
			credId: "test-cred-id",
			wallet: "Test Wallet",
		}),
	),
	qrCode: vi.fn(() => Promise.resolve("mock-qr-code")),
	deepLink: vi.fn(
		(requestId) => `https://liquid-auth.com/link?requestId=${requestId}`,
	),
	peer: vi.fn(() =>
		Promise.resolve({
			on: vi.fn(),
			send: vi.fn(),
			close: vi.fn(),
		}),
	),
	assertion: vi.fn(() => Promise.resolve()),
	attestation: vi.fn(async (onChallenge) => {
		await onChallenge(new Uint8Array([1, 2, 3]));
		return Promise.resolve();
	}),
	close: vi.fn(),
};

vi.mock("@algorandfoundation/liquid-client", () => {
	const SignalClient = vi.fn(() => mockSignalClient);
	(SignalClient as any).generateRequestId = vi.fn(() => "test-request-id");
	return {
		SignalClient: SignalClient,
	};
});

describe("Liquid Auth Extension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should initialize and expose liquidAuth API when WithConnectionStore, WithAccountStore and WithPasskeyStore are present", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		expect(provider.liquidAuth).toBeDefined();
		expect(provider.liquidAuth.createOffer).toBeDefined();
		expect(provider.liquidAuth.joinAsAnswer).toBeDefined();
		expect(provider.liquidAuth.disconnect).toBeDefined();

		// Should have connection store from WithConnectionStore
		expect(provider.connection).toBeDefined();
		expect(provider.connections).toBeDefined();

		// Should have account store from WithAccountStore
		expect(provider.account).toBeDefined();

		// Should have passkey store from WithPasskeyStore
		expect(provider.passkey).toBeDefined();
	});

	it("should throw an error if WithConnectionStore is missing", () => {
		const MyProvider = Provider.withExtensions([
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		expect(() => {
			new MyProvider(
				{ id: "test", name: "Test" },
				{
					liquidAuth: {
						endpoint: "https://test-liquid-auth.com",
					},
				},
			);
		}).toThrow(
			"WithLiquidAuth extension requires WithConnectionStore extension to be present on the provider.",
		);
	});

	it("should throw an error if WithAccountStore is missing", () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		expect(() => {
			new MyProvider(
				{ id: "test", name: "Test" },
				{
					liquidAuth: {
						endpoint: "https://test-liquid-auth.com",
					},
				},
			);
		}).toThrow(
			"WithLiquidAuth extension requires WithAccountStore extension to be present on the provider.",
		);
	});

	it("should throw an error if WithPasskeyStore is missing", () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithLiquidAuth,
		]);
		expect(() => {
			new MyProvider(
				{ id: "test", name: "Test" },
				{
					liquidAuth: {
						endpoint: "https://test-liquid-auth.com",
					},
				},
			);
		}).toThrow(
			"WithLiquidAuth extension requires WithPasskeyStore extension to be present on the provider.",
		);
	});

	it("should create offer and add connection to store on wait", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		const origin = "https://test-dapp.com";
		const offer = await provider.liquidAuth.createOffer(origin);
		expect(offer.requestId).toBe("test-request-id");
		expect(offer.deepLink).toContain("test-request-id");

		const connection = await offer.wait();
		expect(connection.id).toBe("Test Wallet");
		expect(connection.address).toBe("Test Wallet");

		// Check if connection is in the store
		const connections = provider.connections;
		expect(connections).toHaveLength(1);
		expect(connections[0].id).toBe("Test Wallet");
	});

	it("should join as answer and add connection to store if account exists", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		const mockAddress = "TEST_ADDRESS";
		// Mock addAccount to ensure it exists
		await provider.account.store.addAccount({
			address: mockAddress,
			type: "ed25519",
			balance: BigInt(0),
			assets: [],
			sign: vi.fn((txns) => Promise.resolve(txns)),
		});

		const origin = "https://test-dapp.com";
		const connection = await provider.liquidAuth.joinAsAnswer(
			"test-request-id",
			mockAddress,
			origin,
		);
		expect(connection.id).toBe(mockAddress);
		expect(connection.address).toBe(mockAddress);

		// Check if connection is in the store
		const connections = provider.connections;
		expect(connections).toHaveLength(1);
		expect(connections[0].id).toBe(mockAddress);
	});

	it("should join as answer and parse requestId from deep link", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		const mockAddress = "TEST_ADDRESS";
		await provider.account.store.addAccount({
			address: mockAddress,
			type: "ed25519",
			balance: BigInt(0),
			assets: [],
			sign: vi.fn((txns) => Promise.resolve(txns)),
		});

		const deepLink = "https://liquid-auth.com/link?requestId=parsed-request-id";
		const origin = "https://test-dapp.com";
		const connection = await provider.liquidAuth.joinAsAnswer(
			deepLink,
			mockAddress,
			origin,
		);

		expect(mockSignalClient.peer).toHaveBeenCalledWith(
			"parsed-request-id",
			"answer",
		);
		expect(connection.id).toBe(mockAddress);
	});

	it("should use assertion if passkey exists for account", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		const mockAddress = "TEST_ADDRESS";
		await provider.account.store.addAccount({
			address: mockAddress,
			type: "ed25519",
			balance: BigInt(0),
			assets: [],
			sign: vi.fn((txns) => Promise.resolve(txns)),
		});

		// Add a matching passkey
		await provider.passkey.store.addPasskey({
			id: "test-passkey-id",
			name: "Test Passkey",
			publicKey: new Uint8Array([1, 2, 3]),
			algorithm: "ES256",
			metadata: { userHandle: mockAddress },
		});

		const origin = "https://test-dapp.com";
		await provider.liquidAuth.joinAsAnswer(
			"test-request-id",
			mockAddress,
			origin,
		);

		expect(mockSignalClient.assertion).toHaveBeenCalled();
		expect(mockSignalClient.attestation).not.toHaveBeenCalled();
	});

	it("should use attestation if no passkey exists for account", async () => {
		const MyProvider = Provider.withExtensions([
			WithConnectionStore,
			WithAccountStore,
			WithPasskeyStore,
			WithLiquidAuth,
		]);
		const provider = new MyProvider(
			{ id: "test", name: "Test" },
			{
				liquidAuth: {
					endpoint: "https://test-liquid-auth.com",
				},
			},
		) as any;

		const mockAddress = "TEST_ADDRESS";
		const mockSign = vi.fn((txns) => Promise.resolve(txns));
		await provider.account.store.addAccount({
			address: mockAddress,
			type: "ed25519",
			balance: BigInt(0),
			assets: [],
			sign: mockSign,
		});

		const origin = "https://test-dapp.com";
		await provider.liquidAuth.joinAsAnswer(
			"test-request-id",
			mockAddress,
			origin,
		);

		expect(mockSignalClient.attestation).toHaveBeenCalled();
		expect(mockSignalClient.assertion).not.toHaveBeenCalled();
		expect(mockSign).toHaveBeenCalled();
	});
});
