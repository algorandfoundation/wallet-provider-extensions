import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { WithPasskeys } from "./extension.ts";
import type { Passkey, PasskeysExtension, PasskeysState } from "./types.ts";

const passkeyA: Passkey = { credentialId: "cred-a", rpId: "example.com" };
const passkeyB: Passkey = { credentialId: "cred-b", rpId: "example.com" };

describe("WithPasskeys (core)", () => {
  it("mounts the store API over an injected store", async () => {
    const store = new Store<PasskeysState>({ passkeys: [passkeyA] });
    const extension: PasskeysExtension = WithPasskeys({} as never, { passkeys: { store } });

    expect(extension.passkeys).toEqual([passkeyA]);
    await expect(extension.passkey.store.getPasskeys()).resolves.toEqual([passkeyA]);
  });

  it("creates an empty store when nothing is injected", async () => {
    const extension: PasskeysExtension = WithPasskeys({} as never, {});

    expect(extension.passkeys).toEqual([]);
    await expect(extension.passkey.store.getPasskeys()).resolves.toEqual([]);
    // The remote mirror moved to @algorandfoundation/passkeys-connections-extension.
    expect("remote" in extension.passkey).toBe(false);
  });

  it("adds, gets, removes, and clears passkeys through the API", async () => {
    const extension: PasskeysExtension = WithPasskeys({} as never, {});

    await extension.passkey.store.addPasskey(passkeyA);
    await extension.passkey.store.addPasskey(passkeyB);
    await expect(extension.passkey.store.getPasskey("cred-a")).resolves.toEqual(passkeyA);

    await extension.passkey.store.removePasskey("cred-a");
    expect(extension.passkeys).toEqual([passkeyB]);

    await extension.passkey.store.clear();
    expect(extension.passkeys).toEqual([]);
  });

  it("keeps the reactive passkeys member in sync with feeder writes", async () => {
    const store = new Store<PasskeysState>({ passkeys: [] });
    const extension: PasskeysExtension = WithPasskeys({} as never, { passkeys: { store } });

    // A feeder (bridge, native module) writes into the same store instance.
    store.setState((state) => ({ ...state, passkeys: [passkeyA] }));

    expect(extension.passkeys).toEqual([passkeyA]);
  });

  it("reconciles against server options and writes the result back", async () => {
    const extension: PasskeysExtension = WithPasskeys({} as never, {});
    await extension.passkey.store.addPasskey(passkeyA);
    await extension.passkey.store.addPasskey(passkeyB);

    const result = await extension.passkey.store.reconcile({
      rpId: "example.com",
      allowCredentials: [{ id: "cred-a" }],
    });

    expect(result.known.map((p) => p.credentialId)).toEqual(["cred-a"]);
    expect(result.strays.map((p) => p.credentialId)).toEqual(["cred-b"]);
    expect(extension.passkeys).toEqual(result.passkeys);
    expect(extension.passkeys[0].serverStatus).toBe("known");
    expect(extension.passkeys[1].serverStatus).toBe("unknown");
  });

  it("exposes hooks and runs registered before hooks", async () => {
    const extension: PasskeysExtension = WithPasskeys({} as never, {});
    const before = vi.fn();
    extension.passkey.store.hooks.before("remove", before);

    await extension.passkey.store.addPasskey(passkeyA);
    await extension.passkey.store.removePasskey("cred-a");

    expect(before).toHaveBeenCalledOnce();
    expect(before.mock.calls[0][0]).toMatchObject({ credentialId: "cred-a" });
  });

  it("uses provider.log for reconcile logging when no logger is injected", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      clear: vi.fn(),
    };
    const extension: PasskeysExtension = WithPasskeys({ log } as never, {});

    await extension.passkey.store.reconcile({ rpId: "example.com" });

    expect(log.info).toHaveBeenCalled();
  });

  it("reuses an already-mounted store API (idempotent extend)", () => {
    const first: PasskeysExtension = WithPasskeys({} as never, {});
    const second: PasskeysExtension = WithPasskeys(first as never, {});

    expect(second.passkey.store).toBe(first.passkey.store);
  });
});
