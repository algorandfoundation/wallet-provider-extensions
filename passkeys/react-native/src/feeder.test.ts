import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";

import { removePasskey } from "@algorandfoundation/passkeys-core";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";

import { nativePasskeysFeeder, toPasskey } from "./feeder.ts";
import type {
  PasskeyAutofillCredentialIdentityLike,
  PasskeyAutofillEventPayload,
  PasskeyAutofillModuleLike,
} from "./feeder.ts";

const nativeIdentity: PasskeyAutofillCredentialIdentityLike = {
  credentialId: "cred-a",
  relyingPartyIdentifier: "example.com",
  origin: "https://example.com",
  userName: "user@example.com",
  userHandle: "user-1",
  privateKeyBase64: "U0VDUkVU",
  publicKeyBase64: "UFVCTElD",
  userId: "internal-1",
  createdAt: 1000,
};

type Listener = (event: PasskeyAutofillEventPayload) => void;

function makeModule(credentials: PasskeyAutofillCredentialIdentityLike[] = [nativeIdentity]): {
  module: PasskeyAutofillModuleLike;
  credentials: PasskeyAutofillCredentialIdentityLike[];
  emit: (eventName: string, event?: PasskeyAutofillEventPayload) => void;
} {
  const listeners = new Map<string, Set<Listener>>();
  const state = { credentials: [...credentials] };
  const module: PasskeyAutofillModuleLike = {
    getStoredCredentials: vi.fn(async () => [...state.credentials]),
    deleteCredential: vi.fn(async (credentialId: string) => {
      state.credentials = state.credentials.filter((c) => c.credentialId !== credentialId);
    }),
    clearCredentials: vi.fn(async () => {
      state.credentials = [];
    }),
    isProviderActive: vi.fn(async () => true),
    openProviderSettings: vi.fn(async () => true),
    addListener: vi.fn((eventName: string, listener: Listener) => {
      const set = listeners.get(eventName) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(eventName, set);
      return { remove: () => set.delete(listener) };
    }),
  };
  return {
    module,
    get credentials() {
      return state.credentials;
    },
    set credentials(value: PasskeyAutofillCredentialIdentityLike[]) {
      state.credentials = value;
    },
    emit: (eventName: string, event: PasskeyAutofillEventPayload = { success: true }) => {
      for (const listener of listeners.get(eventName) ?? []) listener(event);
    },
  };
}

describe("toPasskey", () => {
  it("maps the public fields and DROPS key material and userId", () => {
    expect(toPasskey(nativeIdentity)).toEqual({
      credentialId: "cred-a",
      rpId: "example.com",
      origin: "https://example.com",
      userName: "user@example.com",
      userHandle: "user-1",
      createdAt: 1000,
    });
  });

  it("normalizes rpId and userName fallbacks", () => {
    expect(toPasskey({ credentialId: "x", rpId: "rp.example", name: "fallback" })).toEqual({
      credentialId: "x",
      rpId: "rp.example",
      userName: "fallback",
    });
  });
});

describe("nativePasskeysFeeder", () => {
  it("syncs the native list into the store on start", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    expect(store.state.passkeys).toEqual([toPasskey(nativeIdentity)]);
  });

  it("re-syncs on native events", async () => {
    const fixture = makeModule([]);
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;
    expect(store.state.passkeys).toEqual([]);

    fixture.credentials = [nativeIdentity];
    fixture.emit("onPasskeyAdded");
    await vi.waitFor(() => {
      expect(store.state.passkeys).toEqual([toPasskey(nativeIdentity)]);
    });

    fixture.credentials = [];
    fixture.emit("onPasskeyAuthenticated");
    await vi.waitFor(() => {
      expect(store.state.passkeys).toEqual([]);
    });
  });

  it("does NOT call deleteCredential when the native side removed the record", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    fixture.credentials = [];
    await feeder.refresh();

    expect(store.state.passkeys).toEqual([]);
    expect(fixture.module.deleteCredential).not.toHaveBeenCalled();
  });

  it("propagates a store removal of a native-sourced passkey to deleteCredential", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    removePasskey({ store, credentialId: "cred-a" });

    expect(fixture.module.deleteCredential).toHaveBeenCalledExactlyOnceWith("cred-a");
  });

  it("ignores store removals of passkeys it does not own", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({
      passkeys: [{ credentialId: "bridge-owned", metadata: { keyId: "key-1" } }],
    });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    removePasskey({ store, credentialId: "bridge-owned" });

    expect(fixture.module.deleteCredential).not.toHaveBeenCalled();
  });

  it("merges over existing records so store-side fields survive a refresh", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    // A reconcile pass wrote serverStatus into the store.
    store.setState((state) => ({
      ...state,
      passkeys: state.passkeys.map((p) => ({ ...p, serverStatus: "known" as const })),
    }));

    await feeder.refresh();
    expect(store.state.passkeys[0].serverStatus).toBe("known");
  });

  it("ready resolves even when the module throws (log-and-continue)", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      clear: vi.fn(),
    };
    const module: PasskeyAutofillModuleLike = {
      ...makeModule().module,
      getStoredCredentials: vi.fn(async () => {
        throw new Error("native module unavailable");
      }),
    };
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module, store, log: log as never });

    await expect(feeder.ready).resolves.toBeUndefined();
    expect(store.state.passkeys).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("stop() unsubscribes from native events and the store", async () => {
    const fixture = makeModule();
    const store = new Store<PasskeysState>({ passkeys: [] });
    const feeder = nativePasskeysFeeder({ module: fixture.module, store });
    await feeder.ready;

    feeder.stop();

    removePasskey({ store, credentialId: "cred-a" });
    expect(fixture.module.deleteCredential).not.toHaveBeenCalled();

    fixture.emit("onPasskeyAdded");
    expect(fixture.module.getStoredCredentials).toHaveBeenCalledOnce();
  });
});
