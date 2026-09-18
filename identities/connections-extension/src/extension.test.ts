import type { Identity, IdentityStoreState } from "@algorandfoundation/identities-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { WithIdentitiesConnections } from "./extension.ts";

function makeStore(identities: Identity[] = []): Store<IdentityStoreState<Identity>> {
  return new Store<IdentityStoreState<Identity>>({ identities });
}

describe("WithIdentitiesConnections", () => {
  it("mounts the remote mirror over the injected shared store", () => {
    const store = makeStore([
      { address: "did:key:zLOCAL", type: "did:key", metadata: { source: "local" } },
    ]);
    const provider = { id: "wallet-1" } as any;

    const extension = WithIdentitiesConnections(provider, { identities: { store } });

    expect(extension.identity.remote).toBeDefined();
    expect(extension.identity.remote.expose().map((i) => i.address)).toEqual(["did:key:zLOCAL"]);

    // Receive feeds the same reactive state the store extension reads.
    extension.identity.remote.receive("session-1", [{ address: "did:key:zPEER", type: "did:key" }]);
    expect(store.state.identities).toHaveLength(2);
    // Session mirrors never echo back through expose.
    expect(extension.identity.remote.expose().map((i) => i.address)).toEqual(["did:key:zLOCAL"]);
  });

  it("returns only the identity namespace, preserving its existing members", () => {
    const store = makeStore();
    const identityStore = { hooks: {} };
    const provider = {
      id: "wallet-1",
      identities: ["not-copied"],
      identity: { store: identityStore },
    } as any;

    const extension = WithIdentitiesConnections(provider, { identities: { store } }) as any;

    // The already-mounted store API rides along in the namespace...
    expect(extension.identity.store).toBe(identityStore);
    expect(extension.identity.remote).toBeDefined();
    // ...but nothing from the provider itself is spread onto the surface.
    expect(Object.keys(extension)).toEqual(["identity"]);
    expect(Object.getOwnPropertyDescriptor(extension, "identities")).toBeUndefined();
  });

  it("is idempotent: reuses an already-mounted provider.identity.remote", () => {
    const store = makeStore();
    const mounted = { expose: () => [], receive: () => {}, revoke: () => {} };
    const provider = { id: "wallet-1", identity: { remote: mounted } } as any;

    const extension = WithIdentitiesConnections(provider, { identities: { store } });

    expect(extension.identity.remote).toBe(mounted);
  });

  it("throws a clear error when the shared store is missing", () => {
    const provider = { id: "wallet-1" } as any;

    expect(() => WithIdentitiesConnections(provider)).toThrow(
      "WithIdentitiesConnections requires options.identities.store (the shared identities store)",
    );
    expect(() => WithIdentitiesConnections(provider, { identities: {} })).toThrow(
      "WithIdentitiesConnections requires options.identities.store (the shared identities store)",
    );
  });
});
