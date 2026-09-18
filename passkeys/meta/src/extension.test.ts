import type { Passkey, PasskeysState } from "@algorandfoundation/passkeys-core";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { WithPasskeys } from "./extension.ts";

const localPasskey: Passkey = { credentialId: "local-1", rpId: "wallet.example" };
const peerPasskey: Passkey = { credentialId: "peer-1", rpId: "dapp.example" };

describe("WithPasskeys (meta)", () => {
  it("threads the shared store to both the core store and the bridge mirror", async () => {
    const store = new Store<PasskeysState>({ passkeys: [] });
    const provider: any = { id: "wallet-1" };

    const api = WithPasskeys(provider, { passkeys: { store } });

    // The remote mirror is attached once the dynamic bridge import resolves;
    // `store.ready` settles exactly when it has.
    await api.passkey.store.ready;
    expect(api.passkey.remote).toBeDefined();

    // Writes through the store API are visible to the mirror: one shared store.
    await api.passkey.store.addPasskey(localPasskey);
    expect(api.passkeys).toEqual([localPasskey]);
    expect(api.passkey.remote!.expose()).toEqual([localPasskey]);

    // ... and records the mirror receives ride the same reactive state.
    api.passkey.remote!.receive("session-1", [peerPasskey]);
    expect(store.state.passkeys).toEqual([localPasskey, peerPasskey]);
    // Session mirrors never echo back through expose.
    expect(api.passkey.remote!.expose()).toEqual([localPasskey]);
  });

  it("attaches the remote mirror onto the shared namespace object", async () => {
    const provider: any = { id: "wallet-1" };

    const api = WithPasskeys(provider, {});
    // The reference a consumer takes before the bridge resolves...
    const namespace = api.passkey;

    await api.passkey.store.ready;
    expect(api.passkey.remote).toBeDefined();

    // ...carries the mirror too: the namespace is shared, not shallow-copied.
    expect(namespace.remote).toBe(api.passkey.remote);
  });

  it("degrades gracefully when the bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/passkeys-connections-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/passkeys-connections-extension'");
    });
    try {
      const provider: any = { id: "wallet-1" };

      // Mounting must not throw; the bridge import rejection is swallowed.
      const api = WithPasskeys(provider, {});

      // `ready` still resolves (never rejects) when the bridge is missing.
      await expect(api.passkey.store.ready).resolves.toBeUndefined();

      expect(api.passkey.remote).toBeUndefined();
      // The local store surface still works without the bridge.
      await api.passkey.store.addPasskey(localPasskey);
      expect(api.passkeys).toEqual([localPasskey]);
    } finally {
      vi.doUnmock("@algorandfoundation/passkeys-connections-extension");
    }
  });

  it("attaches ready onto the store API instance the core mounted", async () => {
    const store = new Store<PasskeysState>({ passkeys: [] });
    const provider: any = { id: "wallet-1" };

    // First mount owns the store API; a second (incremental) mount reuses it.
    const first = WithPasskeys(provider, { passkeys: { store } });
    provider.passkey = first.passkey;
    const second = WithPasskeys(provider, { passkeys: { store } });

    // The reused instance carries `ready` — not a copy.
    expect(second.passkey.store).toBe(first.passkey.store);
    expect(second.passkey.store.ready).toBeInstanceOf(Promise);

    // Awaiting after (or twice) is idempotent: the same settled promise.
    await second.passkey.store.ready;
    await second.passkey.store.ready;
    expect(second.passkey.remote).toBeDefined();
  });
});
