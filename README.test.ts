import { describe, expect, it } from "vitest";
import { Provider } from "@algorandfoundation/wallet-provider";
import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { addSecret } from "@algorandfoundation/keystore-extension";
import BIP39CryptoExtension from "@algorandfoundation/bip39-crypto-extension";
import XHDCryptoExtension from "@algorandfoundation/xhd-crypto-extension";

const WithKeystoreExtension: Extension<any> = (provider) => {
    const store = new Store({ secrets: [] });
    // Define a reflective property on the provider that returns the extension's state'
    Object.defineProperty(provider, "secrets", {
        get() {
            return store.state.secrets;
        },
        configurable: true,
        enumerable: true,
    });
    return {
        keystore: {
            add: async (key: any) => {
                //@ts-expect-error, this is a loosely typed extension
                addSecret(store, key);
                return key;
            },
            remove: async (id: string) => {
                store.setState((s) => ({
                    //@ts-expect-error, this is a loosely typed extension
                    secrets: s.secrets.filter((k) => k.id !== id),
                }));
            },
            import: async (key: any) => {
                //@ts-expect-error, this is a loosely typed extension
                addSecret(store, key);
                return key;
            },
            export: async (id: string) => {
                //@ts-expect-error, this is a loosely typed extension
                return store.state.secrets.find((k) => k.id === id);
            },
        },
    };
};

describe("Root README Examples", () => {
    it("should run the Keystore Extension example", async () => {
        const MyProvider = Provider.withExtensions([WithKeystoreExtension]);
        const provider = new MyProvider({ id: "p", name: "n" }) as any;

        // Add a secret to the keystore
        await provider.keystore.add({
            id: "my-key-id",
            name: "My Main Key",
            type: "algo25",
            value: "your secret mnemonic here...",
        });

        // Retrieve all secrets
        const allSecrets = provider.secrets;
        expect(allSecrets).toHaveLength(1);
    });

    it("should run the BIP-39 Crypto Extension example", async () => {
        const MyProvider = Provider.withExtensions([WithKeystoreExtension, BIP39CryptoExtension]);
        const provider = new MyProvider({ id: "p", name: "n" }, {
            keystore: true
        }) as any;

        // Generate a new 24-word mnemonic
        const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });
        expect(mnemonic.value.split(" ")).toHaveLength(24);

        // Import a mnemonic into the provider's keystore
        await provider.crypto.bip39.import({
            mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            id: "my-imported-key"
        });
        expect(provider.secrets).toHaveLength(1);
    });

    it("should run the XHD Crypto Extension example", async () => {
        const MyProvider = Provider.withExtensions([XHDCryptoExtension]);
        const provider = new MyProvider({ id: "p", name: "n" }) as any;

        // Access XHD Wallet API
        const xhdApi = provider.crypto.xhd;
        expect(xhdApi).toBeDefined();

        // Use cryptographic primitives
        const hash = provider.crypto.sha512_256(new Uint8Array([1, 2, 3]));
        expect(hash).toBeDefined();

        // Use base32
        const encoded = provider.crypto.base32.encode(new Uint8Array([1, 2, 3]));
        expect(encoded).toBeDefined();
    });

    it("should run the 'Creating a New Extension' example", () => {
        // 1. Define the Extension Types
        interface LoggerState {
            logs: string[];
        }
        interface LoggerApi {
            log: (message: string) => void;
            clear: () => void;
        }
        interface LoggerExtension extends LoggerState {
            logger: LoggerApi;
        }

        // 2. Implement the Extension
        const store = new Store<LoggerState>({ logs: [] });
        const loggerExtension: Extension<LoggerExtension> = (provider) => {
            // Define a reflective property on the provider that returns the extension's state'
            Object.defineProperty(provider, "logs", {
                get() {
                    return store.state.logs;
                },
                configurable: true,
                enumerable: true,
            });
            return {
                logger: {
                    log: (message: string) => {
                        store.setState((state) => ({
                            logs: [...state.logs, `${new Date().toISOString()}: ${message}`],
                        }));
                    },
                    clear: () => {
                        store.setState(() => ({ logs: [] }));
                    },
                }
        } as LoggerExtension};

        const MyProvider = Provider.withExtensions([loggerExtension]);
        const provider = new MyProvider({ id: "p", name: "n" }) as any;

        provider.logger.log("Hello");
        console.log(provider.logs, store.state)
        expect(provider.logs).toHaveLength(1);
        expect(provider.logs[0]).toContain("Hello");
    });

    it("should run the 'Using Extensions in a Provider' example", async () => {
        // A Provider can be extended with multiple extensions
        class MyProvider extends Provider<any> {
            static EXTENSIONS = [WithKeystoreExtension, BIP39CryptoExtension, XHDCryptoExtension];
        }

        const provider = new MyProvider({ id: "p", name: "n" }, { keystore: true }) as any;

        // Now you can access extension APIs directly on the provider
        const mnemonic = await provider.crypto.bip39.generate({ strength: 256 });
        expect(mnemonic.value.split(" ")).toHaveLength(24);

        // Use XHD key generation
        const rootKey = new Uint8Array(96).fill(1);
        const publicKey = await provider.crypto.xhd.keyGen(
            rootKey, // 96 bytes extended root key
            0,       // KeyContext.Address
            0,       // account
            0        // keyIndex
        );
        expect(publicKey).toBeDefined();
    });
});
