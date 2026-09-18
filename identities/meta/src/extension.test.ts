import { describe, it, expect, vi, beforeEach } from "vitest";
import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { WithIdentities } from "./extension.ts";
import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import type { IdentityStoreState } from "@algorandfoundation/identities-core";

describe("WithIdentities Extension", () => {
  let keyStore: Store<KeyStoreState>;
  let identityStore: Store<IdentityStoreState>;
  let mockProvider: any;
  let mockOptions: any;

  beforeEach(() => {
    keyStore = new Store<KeyStoreState>({
      keys: [],
      status: "idle",
    });
    identityStore = new Store<IdentityStoreState>({
      identities: [],
    });

    mockProvider = {};

    mockOptions = {
      keystore: { store: keyStore },
      identities: { store: identityStore },
    };
  });

  it("should initialize identity store", () => {
    const provider = WithIdentities(mockProvider, mockOptions);
    expect(provider.identity).toBeDefined();
    expect(provider.identities).toBeDefined();
  });

  it("should not initialize identities-keystore if keystore is missing", () => {
    const provider = WithIdentities(mockProvider, mockOptions);
    expect(provider.identity.store.restoreFromDidDocument).toBeUndefined();
  });

  it("should initialize identities-keystore if keystore is present", () => {
    mockProvider.key = {
      store: {
        generate: vi.fn(),
        sign: vi.fn(),
      },
    };
    const provider = WithIdentities(mockProvider, mockOptions);
    expect(provider.identity.store.restoreFromDidDocument).toBeDefined();
  });

  it("should degrade gracefully when the keystore bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/identities-keystore-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/identities-keystore-extension'");
    });
    try {
      mockProvider.key = {
        store: {
          generate: vi.fn(),
          sign: vi.fn(),
        },
      };
      // Mounting must not throw; the bridge import rejection is swallowed.
      const provider = WithIdentities(mockProvider, mockOptions);
      // The failure only surfaces lazily, through restoreFromDidDocument.
      await expect(provider.identity.store.restoreFromDidDocument({} as any)).rejects.toThrow();
    } finally {
      vi.doUnmock("@algorandfoundation/identities-keystore-extension");
    }
  });

  it("threads the shared store to both the core store and the connections bridge mirror", async () => {
    const provider = WithIdentities(mockProvider, mockOptions);

    // The remote mirror is attached once the dynamic bridge import resolves;
    // `store.ready` settles exactly when it has.
    await provider.identity.store.ready;
    expect(provider.identity.remote).toBeDefined();

    // Writes through the store API are visible to the mirror: one shared store.
    await provider.identity.store.addIdentity({
      address: "did:key:zLOCAL",
      type: "did:key",
      metadata: { source: "local" },
    });
    expect(provider.identity.remote!.expose().map((i) => i.address)).toEqual(["did:key:zLOCAL"]);

    // ... and records the mirror receives ride the same reactive state.
    provider.identity.remote!.receive("session-1", [{ address: "did:key:zPEER", type: "did:key" }]);
    expect(identityStore.state.identities.map((i) => i.address).sort()).toEqual([
      "did:key:zLOCAL",
      "did:key:zPEER",
    ]);
    // Session mirrors never echo back through expose.
    expect(provider.identity.remote!.expose().map((i) => i.address)).toEqual(["did:key:zLOCAL"]);
  });

  it("attaches the remote mirror onto the shared namespace object", async () => {
    const provider = WithIdentities(mockProvider, mockOptions);
    // The reference a consumer takes before the bridge resolves...
    const namespace = provider.identity;

    await provider.identity.store.ready;
    expect(provider.identity.remote).toBeDefined();

    // ...carries the mirror too: the namespace is shared, not shallow-copied.
    expect(namespace.remote).toBe(provider.identity.remote);
  });

  it("should degrade gracefully when the connections bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/identities-connections-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/identities-connections-extension'");
    });
    try {
      // Mounting must not throw; the bridge import rejection is swallowed.
      const provider = WithIdentities(mockProvider, mockOptions);

      // `ready` still resolves (never rejects) when the bridge is missing.
      await expect(provider.identity.store.ready).resolves.toBeUndefined();

      expect(provider.identity.remote).toBeUndefined();
      // The local store surface still works without the bridge.
      await provider.identity.store.addIdentity({ address: "addr1", type: "xhd" });
      expect(provider.identities).toHaveLength(1);
    } finally {
      vi.doUnmock("@algorandfoundation/identities-connections-extension");
    }
  });

  it("awaits both the keystore and connections bridges through store.ready", async () => {
    mockProvider.key = {
      store: {
        generate: vi.fn(),
        sign: vi.fn(),
      },
    };
    const provider = WithIdentities(mockProvider, mockOptions);

    // `ready` lives on the same store API instance the core mounted.
    const store = provider.identity.store;
    await store.ready;

    // Both bridges have settled: the mirror is mounted and the keystore
    // bridge's lazy surface is callable without racing its import.
    expect(provider.identity.remote).toBeDefined();
    expect(provider.identity.store.restoreFromDidDocument).toBeDefined();
    expect(provider.identity.store).toBe(store);
  });

  it("should auto-populate identities if keystore is present", async () => {
    mockProvider.key = {
      store: {
        generate: vi.fn(),
        sign: vi.fn(),
      },
    };

    const publicKey = new Uint8Array(32).fill(1);
    const mockKey = {
      id: "key1",
      type: "hd-derived-ed25519",
      publicKey,
      metadata: { context: 1 },
    };

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "ready" }));

    WithIdentities(mockProvider, mockOptions);

    await vi.waitFor(() => {
      expect(identityStore.state.identities.length).toBeGreaterThan(0);
    });

    expect(identityStore.state.identities[0].metadata?.keyId).toBe("key1");
  });

  it("keeps provider.identities live when mounted through Provider.withExtensions", async () => {
    const MyProvider = Provider.withExtensions([WithIdentities]);
    const provider = new MyProvider(
      { id: "wallet", name: "Wallet" },
      { identities: { store: identityStore } },
    );

    expect(provider.identities).toEqual([]);
    await provider.identity.store.addIdentity({ address: "did:key:zA", type: "did:key" });
    expect(provider.identities.map((i) => i.address)).toEqual(["did:key:zA"]);
    await provider.identity.store.updateIdentityMetadata("did:key:zA", { anchored: true });
    expect(provider.identities[0]?.metadata).toEqual({ anchored: true });

    await provider.identity.store.ready;
    expect(provider.identity.remote).toBeDefined();
  });
});
