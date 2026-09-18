import type { Identity, IdentityStoreState } from "@algorandfoundation/identities-core";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { isRemoteIdentity, remoteIdentitiesMirror } from "./remote.ts";

function makeStore(identities: Identity[] = []): Store<IdentityStoreState<Identity>> {
  return new Store<IdentityStoreState<Identity>>({ identities });
}

function makeLocalIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    address: "did:key:zLOCAL",
    did: "did:key:zLOCAL",
    didDocument: { id: "did:key:zLOCAL" } as Identity["didDocument"],
    type: "did:key",
    sign: vi.fn(async (txns: Uint8Array[]) => txns),
    metadata: { source: "local", keyId: "key-1" },
    ...overrides,
  };
}

describe("remoteIdentitiesMirror", () => {
  it("exposes local identities as data-only records (no signers)", () => {
    const store = makeStore([makeLocalIdentity()]);

    const exposed = remoteIdentitiesMirror(store).expose();

    expect(exposed).toHaveLength(1);
    expect(exposed[0]).toEqual({
      address: "did:key:zLOCAL",
      did: "did:key:zLOCAL",
      didDocument: { id: "did:key:zLOCAL" },
      type: "did:key",
      metadata: { source: "local", keyId: "key-1" },
    });
    expect("sign" in exposed[0]).toBe(false);
  });

  it("excludes previously mirrored remote identities from expose (no echo)", () => {
    const store = makeStore([makeLocalIdentity()]);
    const mirror = remoteIdentitiesMirror(store);

    mirror.receive("session-1", [{ address: "did:key:zPEER", type: "did:key" }]);

    expect(store.state.identities).toHaveLength(2);
    expect(mirror.expose().map((i) => i.address)).toEqual(["did:key:zLOCAL"]);
  });

  it("tags mirrored identities with the session discriminant and re-attaches the context signer", async () => {
    const store = makeStore();
    const mirror = remoteIdentitiesMirror(store);
    const rpc = vi.fn(async (txns: Uint8Array[]) => txns);
    const sign = vi.fn(() => rpc);

    mirror.receive("session-1", [{ address: "did:key:zPEER", type: "did:key" }], { sign });

    const identity = store.state.identities[0];
    expect(identity.metadata).toMatchObject({ source: "connection", sessionId: "session-1" });
    expect(isRemoteIdentity(identity)).toBe(true);
    expect(isRemoteIdentity(identity, "session-1")).toBe(true);
    expect(isRemoteIdentity(identity, "session-2")).toBe(false);
    // The mirrored record signs through the session-routed signer.
    const txns = [new Uint8Array([7])];
    await expect(identity.sign!(txns)).resolves.toEqual(txns);
    expect(rpc).toHaveBeenCalledWith(txns);
  });

  it("replaces the session's previous mirror on receive", () => {
    const store = makeStore();
    const mirror = remoteIdentitiesMirror(store);

    mirror.receive("session-1", [{ address: "did:key:zOLD", type: "did:key" }]);
    mirror.receive("session-1", [{ address: "did:key:zNEW", type: "did:key" }]);

    expect(store.state.identities.map((i) => i.address)).toEqual(["did:key:zNEW"]);
  });

  it("revokes exactly the session's mirrored identities", () => {
    const store = makeStore([makeLocalIdentity()]);
    const mirror = remoteIdentitiesMirror(store);
    mirror.receive("session-1", [{ address: "did:key:zPEER1", type: "did:key" }]);
    mirror.receive("session-2", [{ address: "did:key:zPEER2", type: "did:key" }]);

    mirror.revoke("session-1");

    expect(store.state.identities.map((i) => i.address)).toEqual([
      "did:key:zPEER2",
      "did:key:zLOCAL",
    ]);

    // Revoking an unknown session is a no-op.
    const before = store.state;
    mirror.revoke("session-unknown");
    expect(store.state).toBe(before);
  });
});
