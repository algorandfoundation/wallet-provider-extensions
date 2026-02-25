import { Provider } from "@algorandfoundation/wallet-provider";
import { WithConnectionStore } from "@algorandfoundation/connections-store";
import { describe, expect, it, vi } from "vitest";
import { WithWalletConnect } from "./extension.js";

// Mock SignClient
const mockSignClient = {
    on: vi.fn(),
    connect: vi.fn(() => Promise.resolve({
        approval: vi.fn(() => Promise.resolve({
            topic: "test-topic",
            peer: {
                metadata: {
                    name: "Test dApp",
                    description: "Test Description",
                    url: "https://test.com",
                    icons: ["https://test.com/icon.png"]
                }
            },
            namespaces: {}
        }))
    })),
    disconnect: vi.fn(() => Promise.resolve())
};

vi.mock("@walletconnect/sign-client", () => {
	return {
		default: {
			init: vi.fn(() => Promise.resolve(mockSignClient))
		}
	};
});

describe("WalletConnect Extension", () => {
	it("should initialize and expose walletconnect API when WithConnectionStore is present", async () => {
		const MyProvider = Provider.withExtensions([WithConnectionStore, WithWalletConnect]);
		const provider = new MyProvider({ id: "test", name: "Test" }, {
            walletconnect: {
                projectId: "test-project-id",
                metadata: {
                    name: "Test Wallet",
                    description: "Test Wallet Description",
                    url: "https://test-wallet.com",
                    icons: []
                }
            }
        }) as any;

		expect(provider.walletconnect).toBeDefined();
		expect(provider.walletconnect.connect).toBeDefined();
		expect(provider.walletconnect.disconnect).toBeDefined();
        
        // Should have connection store from WithConnectionStore
        expect(provider.connection).toBeDefined();
        expect(provider.connections).toBeDefined();
	});

    it("should throw an error if WithConnectionStore is missing", () => {
        const MyProvider = Provider.withExtensions([WithWalletConnect]);
        expect(() => {
            new MyProvider({ id: "test", name: "Test" }, {
                walletconnect: {
                    projectId: "test-project-id",
                    metadata: {
                        name: "Test Wallet",
                        description: "Test Wallet Description",
                        url: "https://test-wallet.com",
                        icons: []
                    }
                }
            });
        }).toThrow("WithWalletConnect extension requires WithConnectionStore extension to be present on the provider.");
    });

    it("should connect and add connection to store", async () => {
        const MyProvider = Provider.withExtensions([WithConnectionStore, WithWalletConnect]);
		const provider = new MyProvider({ id: "test", name: "Test" }, {
            walletconnect: {
                projectId: "test-project-id",
                metadata: {
                    name: "Test Wallet",
                    description: "Test Wallet Description",
                    url: "https://test-wallet.com",
                    icons: []
                }
            }
        }) as any;

        const connection = await provider.walletconnect.connect("wc:test-uri");
        expect(connection.topic).toBe("test-topic");
        
        // Check if connection is in the store
        const connections = provider.connections;
        expect(connections).toHaveLength(1);
        expect(connections[0].id).toBe("test-topic");
    });
});
