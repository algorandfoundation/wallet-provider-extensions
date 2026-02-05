import { describe, it, expect } from "vitest";
import { Store } from "@tanstack/store";
import { addSecret, removeSecret, getSecret, type KeyStoreState } from "./store.js";
import type { KeyStoreExtension, SecretKey } from "./types.js";

describe("Keystore Extension", () => {
  it("should align with README usage", async () => {
    // 1. Define the Keystore State
    const store = new Store<KeyStoreState>({
      secrets: []
    });

    // 2. Implement the Extension
    const keystoreExtension: KeyStoreExtension = {
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
    };

    // 3. Use in a Provider (Mocked provider)
    const provider = {} as any & KeyStoreExtension;
    // TODO: Investigate if defineProperty should be used in the base Provider to ensure getters are applied
    // Only if this becomes a standard, using getters to access the reflective store
    Object.defineProperties(provider, Object.getOwnPropertyDescriptors(keystoreExtension));

    const testKey: SecretKey = {
      id: "my-key-1",
      name: "Main Account",
      type: "algo25",
      value: "..." 
    };

    // Access keystore methods
    await provider.keystore.add(testKey);

    expect(provider.secrets).toHaveLength(1);
    expect(provider.secrets[0]).toEqual(testKey);

    const exportedKey = await provider.keystore.export("my-key-1");
    expect(exportedKey).toEqual(testKey);

    await provider.keystore.remove("my-key-1");
    expect(provider.secrets).toHaveLength(0);
  });

  describe("store functions", () => {
    it("should add a secret", () => {
      const store = new Store<KeyStoreState>({ secrets: [] });
      const secret: SecretKey = { id: "1", name: "test", type: "algo25", value: "val" };
      addSecret(store, secret);
      expect(store.state.secrets).toContain(secret);
    });

    it("should remove a secret", () => {
      const secret: SecretKey = { id: "1", name: "test", type: "algo25", value: "val" };
      const store = new Store<KeyStoreState>({ secrets: [secret] });
      removeSecret(store, "1");
      expect(store.state.secrets).not.toContain(secret);
    });

    it("should get a secret", () => {
      const secret: SecretKey = { id: "1", name: "test", type: "algo25", value: "val" };
      const store = new Store<KeyStoreState>({ secrets: [secret] });
      const found = getSecret(store, "1");
      expect(found).toEqual(secret);
    });

    it("should return undefined for non-existent secret", () => {
        const store = new Store<KeyStoreState>({ secrets: [] });
        const found = getSecret(store, "non-existent");
        expect(found).toBeUndefined();
    });
  });
});
