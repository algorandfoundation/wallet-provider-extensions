import { removePasskey } from "@algorandfoundation/passkeys-core";
import type { Passkey, PasskeysState } from "@algorandfoundation/passkeys-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { remotePasskeysMirror } from "./remote.ts";

const localPasskey: Passkey = { credentialId: "local-1", rpId: "wallet.example" };
const peerPasskey: Passkey = { credentialId: "peer-1", rpId: "dapp.example", userName: "main" };

function createStore(passkeys: Passkey[] = []): Store<PasskeysState> {
  return new Store<PasskeysState>({ passkeys });
}

describe("remotePasskeysMirror", () => {
  it("exposes only the local passkeys (mirrors never echo)", () => {
    const store = createStore([localPasskey]);
    const mirror = remotePasskeysMirror(store);

    mirror.receive("session-1", [peerPasskey]);

    expect(mirror.expose()).toEqual([localPasskey]);
    // ... while the store holds both for the UI.
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);
  });

  it("strips function members from exposed and mirrored records", () => {
    const tainted = { ...localPasskey, sign: () => {} } as unknown as Passkey;
    const store = createStore([tainted]);
    const mirror = remotePasskeysMirror(store);

    expect(mirror.expose()).toEqual([localPasskey]);

    mirror.receive("session-1", [{ ...peerPasskey, sign: () => {} } as unknown as Passkey]);
    expect(store.state.passkeys).toEqual([tainted, peerPasskey]);
  });

  it("feeds the passkeys store reactively and revokes cleanly", () => {
    const store = createStore([localPasskey]);
    const mirror = remotePasskeysMirror(store);

    mirror.receive("session-1", [peerPasskey]);
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);

    mirror.revoke("session-1");
    expect(store.state.passkeys).toEqual([localPasskey]);
  });

  it("replaces a session's previous mirror on receive and revokes per session", () => {
    const store = createStore();
    const mirror = remotePasskeysMirror(store);

    mirror.receive("session-1", [{ credentialId: "old" }]);
    mirror.receive("session-1", [{ credentialId: "new" }]);
    mirror.receive("session-2", [peerPasskey]);
    expect(store.state.passkeys).toEqual([{ credentialId: "new" }, peerPasskey]);

    mirror.revoke("session-1");
    expect(store.state.passkeys).toEqual([peerPasskey]);
  });

  it("locals win on credential-id collisions and survive the session", () => {
    const store = createStore([localPasskey]);
    const mirror = remotePasskeysMirror(store);

    mirror.receive("session-1", [{ ...localPasskey, userName: "imposter" }, peerPasskey]);
    // The local record is untouched by the colliding mirror record.
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);
    expect(mirror.expose()).toEqual([localPasskey]);

    mirror.revoke("session-1");
    expect(store.state.passkeys).toEqual([localPasskey]);
  });

  it("keeps a record shared by two sessions until the last one revokes", () => {
    const store = createStore();
    const mirror = remotePasskeysMirror(store);

    mirror.receive("session-1", [peerPasskey]);
    mirror.receive("session-2", [peerPasskey]);

    mirror.revoke("session-1");
    expect(store.state.passkeys).toEqual([peerPasskey]);

    mirror.revoke("session-2");
    expect(store.state.passkeys).toEqual([]);
  });

  it("prunes its tracking when a mirrored record is removed through the store", () => {
    const store = createStore([localPasskey]);
    const mirror = remotePasskeysMirror(store);
    mirror.receive("session-1", [peerPasskey]);

    // A UI removal goes through the store, not the mirror.
    removePasskey({ store, credentialId: peerPasskey.credentialId });
    expect(store.state.passkeys).toEqual([localPasskey]);

    // A local feeder re-adding the same id is now a LOCAL record: exposed
    // and untouched by the session's revoke.
    store.setState((state) => ({ ...state, passkeys: [...state.passkeys, peerPasskey] }));
    expect(mirror.expose()).toEqual([localPasskey, peerPasskey]);

    mirror.revoke("session-1");
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);
  });
});
