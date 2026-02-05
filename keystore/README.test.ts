import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";
import { Provider } from "@algorandfoundation/wallet-provider";
import type { Extension } from "@algorandfoundation/wallet-provider";
import { 
  addSecret, 
  removeSecret, 
  getSecret, 
} from "./src/index.js";
import type { 
  KeyStoreState, 
  KeyStoreExtension, 
  SecretKey 
} from "./src/index.js";

describe("Keystore README Examples", () => {
  it("should run the 'Define the Keystore State' example", () => {
    // @ts-ignore - Example from README
    const store = new Store<KeyStoreState>({
      secrets: []
    });
    expect(store.state.secrets).toEqual([]);
  });

  it("should run the 'Implement the Extension' example", async () => {
    const store = new Store<KeyStoreState>({
      secrets: []
    });

    // @ts-ignore - Example from README
    const keystoreExtension: Extension<KeyStoreExtension> = (provider) => ({
      get secrets() {
        return store.state.secrets;
      },
      keystore: {
        add: async (key: SecretKey) => {
          addSecret(store, key);
          return key;
        },
        remove: async (id: string) => {
          removeSecret(store, id);
        },
        import: async (key: SecretKey) => {
          // Implement specific import logic here
          addSecret(store, key);
          return key;
        },
        export: async (id: string) => {
          const key = getSecret(store, id);
          if (!key) throw new Error("Key not found");
          return key;
        }
      }
    });

    expect(keystoreExtension).toBeDefined();
  });

  it("should run the 'Use in a Provider' example", async () => {
    const store = new Store<KeyStoreState>({
      secrets: []
    });

    const keystoreExtension: Extension<KeyStoreExtension> = (provider) => {
        Object.defineProperty(provider, "secrets", {
            get() {
                return store.state.secrets;
            },
            enumerable: true,
            configurable: true
        });
        return {
            keystore: {
                add: async (key: SecretKey) => {
                    addSecret(store, key);
                    return key;
                },
            }
        } as any;
    };

    // Mock Provider as in README
    const MyProvider = Provider.withExtensions([keystoreExtension]);
    const provider = new MyProvider({ id: "test", name: "Test" }) as any;
    
    // Access keystore methods
    await provider.keystore.add({
      id: "my-key-1",
      name: "Main Account",
      type: "algo25",
      value: "..." 
    });

    expect(provider.secrets).toHaveLength(1);
    expect(provider.secrets[0].id).toBe("my-key-1");
  });
});
