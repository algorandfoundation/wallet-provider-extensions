import type { Passkey, PasskeysState } from "@algorandfoundation/passkeys-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { WithPasskeysConnections } from "./extension.ts";

const localPasskey: Passkey = { credentialId: "local-1", rpId: "wallet.example" };
const peerPasskey: Passkey = { credentialId: "peer-1", rpId: "dapp.example" };

function createStore(passkeys: Passkey[] = []): Store<PasskeysState> {
  return new Store<PasskeysState>({ passkeys });
}

describe("WithPasskeysConnections", () => {
  it("mounts the remote mirror over the injected shared store", () => {
    const store = createStore([localPasskey]);
    const provider = { id: "wallet-1" } as any;

    const extension = WithPasskeysConnections(provider, { passkeys: { store } });

    expect(extension.passkey.remote).toBeDefined();
    expect(extension.passkey.remote.expose()).toEqual([localPasskey]);

    // Receive feeds the same reactive state the store extension reads.
    extension.passkey.remote.receive("session-1", [peerPasskey]);
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);
    // Session mirrors never echo back through expose.
    expect(extension.passkey.remote.expose()).toEqual([localPasskey]);
  });

  it("is idempotent: reuses an already-mounted provider.passkey.remote", () => {
    const store = createStore();
    const mounted = { expose: () => [], receive: () => {}, revoke: () => {} };
    const provider = { id: "wallet-1", passkey: { remote: mounted } } as any;

    const extension = WithPasskeysConnections(provider, { passkeys: { store } });

    expect(extension.passkey.remote).toBe(mounted);
  });

  it("throws a clear error when the shared store is missing", () => {
    const provider = { id: "wallet-1" } as any;

    expect(() => WithPasskeysConnections(provider)).toThrow(
      "WithPasskeysConnections requires options.passkeys.store (the shared passkeys store)",
    );
    expect(() => WithPasskeysConnections(provider, { passkeys: {} })).toThrow(
      "WithPasskeysConnections requires options.passkeys.store (the shared passkeys store)",
    );
  });
});
