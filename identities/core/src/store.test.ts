import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store } from "@tanstack/store";
import {
  addIdentity,
  removeIdentity,
  getIdentity,
  clearIdentities,
  updateIdentityDidDocument,
  updateIdentityMetadata,
} from "./store.ts";
import type { IdentityStoreState, Identity, DIDDocument } from "./types.ts";

describe("Identity Store", () => {
  let store: Store<IdentityStoreState>;

  beforeEach(() => {
    store = new Store<IdentityStoreState>({ identities: [] });
  });

  const mockIdentity: Identity = {
    address: "address1",
    type: "did:key",
    did: "did:key:z1",
  };

  const mockDidDocument: DIDDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: "did:key:z1",
    verificationMethod: [],
    authentication: [],
    assertionMethod: [],
    service: [],
  };

  it("should add an identity", () => {
    const result = addIdentity({ store, identity: mockIdentity });
    expect(result).toEqual(mockIdentity);
    expect(store.state.identities).toContainEqual(mockIdentity);
  });

  it("should not add duplicate identities (replaces existing)", () => {
    addIdentity({ store, identity: mockIdentity });
    const updatedIdentity = { ...mockIdentity, did: "did:key:z1-updated" };
    addIdentity({ store, identity: updatedIdentity });
    expect(store.state.identities.length).toBe(1);
    expect(store.state.identities[0]).toEqual(updatedIdentity);
  });

  it("should get an identity by address", () => {
    addIdentity({ store, identity: mockIdentity });
    const found = getIdentity({ store, address: "address1" });
    expect(found).toEqual(mockIdentity);
  });

  it("should return undefined for non-existent identity", () => {
    const found = getIdentity({ store, address: "non-existent" });
    expect(found).toBeUndefined();
  });

  it("should remove an identity by address", () => {
    addIdentity({ store, identity: mockIdentity });
    removeIdentity({ store, address: "address1" });
    expect(store.state.identities.length).toBe(0);
  });

  it("should clear all identities", () => {
    addIdentity({ store, identity: mockIdentity });
    addIdentity({ store, identity: { ...mockIdentity, address: "address2" } });
    expect(store.state.identities.length).toBe(2);
    clearIdentities({ store });
    expect(store.state.identities.length).toBe(0);
  });

  it("should update DID document", () => {
    addIdentity({ store, identity: mockIdentity });
    const result = updateIdentityDidDocument({
      store,
      address: "address1",
      didDocument: mockDidDocument,
    });
    expect(result?.didDocument).toEqual(mockDidDocument);
    expect(store.state.identities[0]?.didDocument).toEqual(mockDidDocument);
  });

  it("should return undefined when updating non-existent identity", () => {
    const result = updateIdentityDidDocument({
      store,
      address: "non-existent",
      didDocument: mockDidDocument,
    });
    expect(result).toBeUndefined();
  });

  describe("updateIdentityMetadata", () => {
    it("should shallow-merge metadata into an existing identity", () => {
      addIdentity({
        store,
        identity: { ...mockIdentity, metadata: { source: "local", keyId: "key-1" } },
      });
      const result = updateIdentityMetadata({
        store,
        address: "address1",
        metadata: { keyId: "key-2", anchor: { didAlgo: "did:algo:app:1" } },
      });
      expect(result?.metadata).toEqual({
        source: "local",
        keyId: "key-2",
        anchor: { didAlgo: "did:algo:app:1" },
      });
      expect(store.state.identities[0]?.metadata).toEqual(result?.metadata);
      // Other fields are untouched.
      expect(store.state.identities[0]?.did).toBe("did:key:z1");
    });

    it("should create metadata when the identity had none", () => {
      addIdentity({ store, identity: mockIdentity });
      const result = updateIdentityMetadata({ store, address: "address1", metadata: { a: 1 } });
      expect(result?.metadata).toEqual({ a: 1 });
    });

    it("should replace the identity object so subscribers observe the change", () => {
      addIdentity({ store, identity: mockIdentity });
      const before = store.state.identities[0];
      const listener = vi.fn();
      store.subscribe(listener);
      updateIdentityMetadata({ store, address: "address1", metadata: { a: 1 } });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.state.identities[0]).not.toBe(before);
      expect(before.metadata).toBeUndefined();
    });

    it("should return undefined for a non-existent identity", () => {
      addIdentity({ store, identity: mockIdentity });
      const result = updateIdentityMetadata({ store, address: "missing", metadata: { a: 1 } });
      expect(result).toBeUndefined();
      expect(store.state.identities[0]).toEqual(mockIdentity);
    });
  });
});
