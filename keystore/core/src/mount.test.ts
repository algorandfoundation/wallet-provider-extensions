import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { KeyStoreMountError } from "./errors.ts";
import { createKeyStoreExtension, mountKeyStore, parseKeyStoreMount } from "./mount.ts";
import type { KeyStoreState, MountedKeyStoreAPI } from "./types/extension.ts";

/** A keystore stand-in: only the members the mount logic looks at matter. */
function fakeKeyStore(label: string): MountedKeyStoreAPI {
  return {
    label,
    sign: async () => new Uint8Array([1]),
  } as unknown as MountedKeyStoreAPI;
}

function newStore(state?: Partial<KeyStoreState>): Store<KeyStoreState> {
  return new Store<KeyStoreState>({ keys: [], status: "idle", ...state });
}

describe("parseKeyStoreMount", () => {
  it("defaults to the `store` mount", () => {
    expect(parseKeyStoreMount()).toEqual(["store"]);
  });

  it("splits a dotted path", () => {
    expect(parseKeyStoreMount("rpc.ows")).toEqual(["rpc", "ows"]);
  });

  it("rejects an empty path or segment", () => {
    expect(() => parseKeyStoreMount("")).toThrow(KeyStoreMountError);
    expect(() => parseKeyStoreMount("rpc.")).toThrow(KeyStoreMountError);
    expect(() => parseKeyStoreMount("a..b")).toThrow(KeyStoreMountError);
  });
});

describe("mountKeyStore", () => {
  it("mounts at `store` by default", () => {
    const keystore = fakeKeyStore("local");
    expect(mountKeyStore({ keystore })).toEqual({ store: keystore });
  });

  it("mounts a named service without disturbing the existing keystore", () => {
    const local = fakeKeyStore("local");
    const remote = fakeKeyStore("remote");

    const namespace = mountKeyStore({
      namespace: { store: local },
      keystore: remote,
      mount: "rpc.ows",
    });

    expect(namespace.store).toBe(local);
    expect((namespace.rpc as Record<string, unknown>).ows).toBe(remote);
  });

  it("groups several services under one namespace", () => {
    const ows = fakeKeyStore("ows");
    const hsm = fakeKeyStore("hsm");

    const namespace = mountKeyStore({
      namespace: mountKeyStore({ keystore: ows, mount: "rpc.ows" }),
      keystore: hsm,
      mount: "rpc.hsm",
    });

    expect(namespace.rpc).toEqual({ ows, hsm });
  });

  it("never mutates the namespace it was given", () => {
    const existing = { store: fakeKeyStore("local") };
    mountKeyStore({ namespace: existing, keystore: fakeKeyStore("remote"), mount: "rpc" });
    expect(Object.keys(existing)).toEqual(["store"]);
  });

  it("refuses a name that is already answered", () => {
    const namespace = { store: fakeKeyStore("local") };
    expect(() => mountKeyStore({ namespace, keystore: fakeKeyStore("other") })).toThrow(
      KeyStoreMountError,
    );
  });

  it("refuses to reach through a mounted keystore", () => {
    const namespace = { store: fakeKeyStore("local") };
    expect(() =>
      mountKeyStore({ namespace, keystore: fakeKeyStore("other"), mount: "store.ows" }),
    ).toThrow(/not a namespace/);
  });
});

describe("createKeyStoreExtension", () => {
  it("exposes the keystore and live reactive state", () => {
    const store = newStore();
    const keystore = fakeKeyStore("local");

    const extension = createKeyStoreExtension({ provider: {}, store, keystore });

    expect(extension.key.store).toBe(keystore);
    expect(extension.keys).toEqual([]);
    store.setState((state) => ({ ...state, status: "signing" }));
    expect(extension.status).toBe("signing");
    expect(extension.algorithms).toEqual([]);
  });

  it("leaves the reactive state to the keystore that got there first", () => {
    const local = newStore({ status: "idle" });
    const remote = newStore({ status: "connecting" });

    const first = createKeyStoreExtension({
      provider: {},
      store: local,
      keystore: fakeKeyStore("local"),
    });
    // The provider now carries the first extension's members.
    const provider = Object.defineProperties({}, Object.getOwnPropertyDescriptors(first));

    const second = createKeyStoreExtension({
      provider,
      store: remote,
      keystore: fakeKeyStore("remote"),
      mount: "rpc.ows",
    });

    expect("keys" in second).toBe(false);
    expect("status" in second).toBe(false);

    const merged = Object.defineProperties(provider, Object.getOwnPropertyDescriptors(second)) as {
      status: string;
      key: { store: unknown; rpc: { ows: unknown } };
    };

    // Both keystores are reachable and the local one still owns `status`.
    expect(merged.key.store).toBeDefined();
    expect(merged.key.rpc.ows).toBeDefined();
    expect(merged.status).toBe("idle");
    local.setState((state) => ({ ...state, status: "signing" }));
    expect(merged.status).toBe("signing");
  });
});
