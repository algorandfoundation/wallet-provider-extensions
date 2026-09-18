import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import type { PasskeysState } from "@algorandfoundation/passkeys-core";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";

import { WithPasskeys } from "./extension.ts";
import type { ReactNativePasskeysExtension, ReactNativePasskeysOptions } from "./extension.ts";
import type { PasskeyAutofillModuleLike } from "./feeder.ts";

function makeModule(): PasskeyAutofillModuleLike {
  return {
    getStoredCredentials: vi.fn(async () => [
      { credentialId: "cred-a", relyingPartyIdentifier: "example.com", privateKeyBase64: "S3Y" },
    ]),
    deleteCredential: vi.fn(async () => {}),
    clearCredentials: vi.fn(async () => {}),
    isProviderActive: vi.fn(async () => true),
    openProviderSettings: vi.fn(async () => false),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  };
}

describe("WithPasskeys (react-native)", () => {
  it("mounts over an injected native module and syncs the store", async () => {
    const module = makeModule();
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module },
    });
    await extension.passkey.ready;

    // Mapped through toPasskey: key material never reaches the store.
    expect(extension.passkeys).toEqual([{ credentialId: "cred-a", rpId: "example.com" }]);
    // Both native events were subscribed on creation.
    expect(module.addListener).toHaveBeenCalledWith("onPasskeyAdded", expect.any(Function));
    expect(module.addListener).toHaveBeenCalledWith("onPasskeyAuthenticated", expect.any(Function));
  });

  it("mounts the core store API and auto-loads the remote mirror", async () => {
    const module = makeModule();
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module },
    });
    await extension.passkey.ready;

    await expect(extension.passkey.store.getPasskey("cred-a")).resolves.toEqual({
      credentialId: "cred-a",
      rpId: "example.com",
    });
    // The remote mirror is attached once the dynamic bridge import resolves;
    // `store.ready` (distinct from the native-sync `passkey.ready`) settles
    // exactly when it has.
    await extension.passkey.store.ready;
    expect(extension.passkey.remote).toBeDefined();
    expect(extension.passkey.remote!.expose()).toEqual([
      { credentialId: "cred-a", rpId: "example.com" },
    ]);
  });

  it("attaches the remote mirror onto the shared namespace object over the same store", async () => {
    const module = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module, store },
    });
    // The reference a consumer takes before the bridge resolves...
    const namespace = extension.passkey;
    await extension.passkey.ready;

    await extension.passkey.store.ready;
    expect(extension.passkey.remote).toBeDefined();

    // ...carries the mirror too: the namespace is shared, not shallow-copied.
    expect(namespace.remote).toBe(extension.passkey.remote);
    // Records the mirror receives ride the same reactive store the feeder fills.
    extension.passkey.remote!.receive("session-1", [{ credentialId: "peer-1" }]);
    expect(store.state.passkeys.map((p) => p.credentialId)).toEqual(["cred-a", "peer-1"]);
    expect(extension.passkey.remote!.expose().map((p) => p.credentialId)).toEqual(["cred-a"]);
  });

  it("degrades gracefully when the connections bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/passkeys-connections-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/passkeys-connections-extension'");
    });
    try {
      const module = makeModule();
      // Mounting must not throw; the bridge import rejection is swallowed.
      const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
        passkeys: { module },
      });
      await extension.passkey.ready;

      // `store.ready` still resolves (never rejects) when the bridge is missing.
      await expect(extension.passkey.store.ready).resolves.toBeUndefined();

      expect(extension.passkey.remote).toBeUndefined();
      // The local store surface still works without the bridge.
      expect(extension.passkeys).toEqual([{ credentialId: "cred-a", rpId: "example.com" }]);
    } finally {
      vi.doUnmock("@algorandfoundation/passkeys-connections-extension");
    }
  });

  it("propagates store removals to the native module", async () => {
    const module = makeModule();
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module },
    });
    await extension.passkey.ready;

    await extension.passkey.store.removePasskey("cred-a");
    expect(module.deleteCredential).toHaveBeenCalledExactlyOnceWith("cred-a");
  });

  it("mounts the provider probes on the react-native surface", async () => {
    const module = makeModule();
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module },
    });
    await extension.passkey.ready;

    await expect(extension.passkey.providerActive()).resolves.toBe(true);
    await expect(extension.passkey.openProviderSettings()).resolves.toBe(false);
    expect(module.isProviderActive).toHaveBeenCalledOnce();
    expect(module.openProviderSettings).toHaveBeenCalledOnce();
  });

  it("writes into an injected store instance", async () => {
    const module = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const extension: ReactNativePasskeysExtension = WithPasskeys({} as never, {
      passkeys: { module, store },
    });
    await extension.passkey.ready;

    expect(store.state.passkeys).toEqual([{ credentialId: "cred-a", rpId: "example.com" }]);
    expect(extension.passkeys).toBe(store.state.passkeys);
  });

  it("throws a clear error when no module is resolvable", () => {
    // The optional autofill peer is not installed in this workspace, so
    // the lazy default resolution yields nothing.
    expect(() => WithPasskeys({} as never, {})).toThrowError(
      /react-native-passkey-autofill.*passkeys\.module/s,
    );
  });

  it("registers the native module on the shared options.passkeys namespace", () => {
    // Type-level: `passkeys.module` is typed on the shared ExtensionOptions
    // registry once this package is imported.
    const module = makeModule();
    const options: ReactNativePasskeysOptions = { passkeys: { module } };
    const registry: ExtensionOptions = options;

    expect(registry.passkeys?.module).toBe(module);
  });
});
