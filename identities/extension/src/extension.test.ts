import { describe, it, expect, vi, beforeEach } from "vitest";
import { Store } from "@tanstack/store";
import { WithIdentities } from "./extension.ts";
import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import type { IdentityStoreState } from "@algorandfoundation/identities-store";

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

    expect(identityStore.state.identities[0].metadata.keyId).toBe("key1");
  });
});
