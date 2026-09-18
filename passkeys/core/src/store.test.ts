import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { addPasskey, clearPasskeys, getPasskey, getPasskeys, removePasskey } from "./store.ts";
import type { Passkey, PasskeysState } from "./types.ts";

const passkeyA: Passkey = { credentialId: "cred-a", rpId: "example.com" };
const passkeyB: Passkey = { credentialId: "cred-b", rpId: "example.com" };

function createStore(passkeys: Passkey[] = []): Store<PasskeysState> {
  return new Store<PasskeysState>({ passkeys });
}

describe("passkeys store functions", () => {
  it("adds a passkey to the store", () => {
    const store = createStore();

    const added = addPasskey({ store, passkey: passkeyA });

    expect(added).toEqual(passkeyA);
    expect(store.state.passkeys).toEqual([passkeyA]);
  });

  it("upserts by credential id, replacing the record in place", () => {
    const store = createStore([passkeyA, passkeyB]);

    addPasskey({ store, passkey: { ...passkeyA, userName: "renamed" } });

    expect(store.state.passkeys).toEqual([{ ...passkeyA, userName: "renamed" }, passkeyB]);
  });

  it("stores a copy, not the caller's reference", () => {
    const store = createStore();
    const passkey: Passkey = { ...passkeyA };

    addPasskey({ store, passkey });
    passkey.userName = "mutated";

    expect(store.state.passkeys[0].userName).toBeUndefined();
  });

  it("removes a passkey by credential id", () => {
    const store = createStore([passkeyA, passkeyB]);

    removePasskey({ store, credentialId: "cred-a" });

    expect(store.state.passkeys).toEqual([passkeyB]);
  });

  it("remove is a state-preserving no-op for unknown ids", () => {
    const store = createStore([passkeyA]);
    const before = store.state;

    removePasskey({ store, credentialId: "missing" });

    expect(store.state).toBe(before);
  });

  it("gets a passkey by credential id", () => {
    const store = createStore([passkeyA, passkeyB]);

    expect(getPasskey({ store, credentialId: "cred-b" })).toEqual(passkeyB);
    expect(getPasskey({ store, credentialId: "missing" })).toBeUndefined();
  });

  it("gets all passkeys", () => {
    const store = createStore([passkeyA, passkeyB]);

    expect(getPasskeys({ store })).toEqual([passkeyA, passkeyB]);
  });

  it("clears all passkeys", () => {
    const store = createStore([passkeyA, passkeyB]);

    clearPasskeys({ store });

    expect(store.state.passkeys).toEqual([]);
  });

  it("keeps the merged public fields on the record", () => {
    const store = createStore();
    const passkey: Passkey = {
      credentialId: "cred-full",
      name: "user@example.com",
      publicKey: new Uint8Array([1, 2, 3]),
      algorithm: "P256",
      origin: "https://example.com",
      userHandle: "user",
      parentKeyId: "key-1",
      metadata: { keyId: "key-1", keyType: "hd-derived-p256" },
    };

    addPasskey({ store, passkey });

    expect(getPasskey({ store, credentialId: "cred-full" })).toEqual(passkey);
  });
});
