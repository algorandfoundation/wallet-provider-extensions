import { describe, it, expect, vi } from "vitest";
import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { WithIdentities } from "./extension.ts";
import type { Identity, IdentityStoreState } from "./types.ts";

describe("Identity Store Extension", () => {
  const mockProvider = {} as any;

  it("should initialize with default store and hooks", () => {
    const extension = WithIdentities(mockProvider, {});
    expect(extension.identities).toEqual([]);
    expect(extension.identity.store).toBeDefined();
    expect(extension.identity.store.hooks).toBeDefined();
    // The remote mirror moved to @algorandfoundation/identities-connections-extension.
    expect("remote" in extension.identity).toBe(false);
  });

  it("should add an identity via extension API", async () => {
    const extension = WithIdentities(mockProvider, {});
    const mockIdentity: Identity = { address: "addr1", type: "xhd" };

    const result = await extension.identity.store.addIdentity(mockIdentity);
    expect(result).toEqual(mockIdentity);
    expect(extension.identities).toContainEqual(mockIdentity);
  });

  it("should remove an identity via extension API", async () => {
    const extension = WithIdentities(mockProvider, {});
    const mockIdentity: Identity = { address: "addr1", type: "xhd" };

    await extension.identity.store.addIdentity(mockIdentity);
    await extension.identity.store.removeIdentity("addr1");
    expect(extension.identities).toEqual([]);
  });

  it("should trigger hooks", async () => {
    const extension = WithIdentities(mockProvider, {});
    const beforeHook = vi.fn();
    extension.identity.store.hooks.before("add", beforeHook);

    const mockIdentity: Identity = { address: "addr1", type: "xhd" };
    await extension.identity.store.addIdentity(mockIdentity);

    expect(beforeHook).toHaveBeenCalled();
  });

  it("should shallow-merge metadata via updateIdentityMetadata and route it through hooks", async () => {
    const extension = WithIdentities(mockProvider, {});
    const beforeHook = vi.fn();
    extension.identity.store.hooks.before("updateMetadata", beforeHook);

    await extension.identity.store.addIdentity({
      address: "addr1",
      type: "did:key",
      metadata: { source: "local", keyId: "key-1" },
    });

    const updated = await extension.identity.store.updateIdentityMetadata("addr1", {
      keyId: "key-2",
      anchor: { didAlgo: "did:algo:app:1" },
    });

    expect(beforeHook).toHaveBeenCalledTimes(1);
    expect(beforeHook.mock.calls[0][0]).toMatchObject({
      address: "addr1",
      metadata: { keyId: "key-2" },
    });
    expect(updated?.metadata).toEqual({
      source: "local",
      keyId: "key-2",
      anchor: { didAlgo: "did:algo:app:1" },
    });
    expect(extension.identities[0]?.metadata).toEqual(updated?.metadata);

    // Unknown addresses resolve to undefined without touching the store.
    await expect(
      extension.identity.store.updateIdentityMetadata("missing", { a: 1 }),
    ).resolves.toBeUndefined();
    expect(extension.identities).toHaveLength(1);
  });

  it("reuses an identity.store already mounted on the provider", () => {
    const mounted = { hooks: {} } as any;
    const extension = WithIdentities({ identity: { store: mounted } } as any, {});
    expect(extension.identity.store).toBe(mounted);
  });

  describe("mounted on a Provider", () => {
    it("keeps provider.identities live and returns only its own surface", async () => {
      const store = new Store<IdentityStoreState>({ identities: [] });
      const MyProvider = Provider.withExtensions([WithIdentities]);
      const provider = new MyProvider({ id: "wallet", name: "Wallet" }, { identities: { store } });

      // The `identities` getter the extension contributes stays reactive
      // after the Provider re-defines it via Object.defineProperties.
      expect(provider.identities).toEqual([]);
      await provider.identity.store.addIdentity({ address: "did:key:zA", type: "did:key" });
      expect(provider.identities.map((i) => i.address)).toEqual(["did:key:zA"]);
      store.setState((s) => ({ ...s, identities: [] }));
      expect(provider.identities).toEqual([]);

      // No provider metadata was copied onto the extension surface.
      const surface = WithIdentities(provider as any, { identities: { store } });
      expect(Object.keys(surface).sort()).toEqual(["identities", "identity"]);
      expect(Object.getOwnPropertyDescriptor(surface, "identities")?.get).toBeTypeOf("function");
    });
  });
});
