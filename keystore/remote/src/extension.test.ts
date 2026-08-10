import {
  createKeyStoreExtension,
  type Key,
  type KeyId,
  type KeyStore,
  type KeyStoreExtension,
  type KeyStoreState,
  type MountedKeyStoreAPI,
} from "@algorandfoundation/keystore-core";
import { type Extension, Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { WithRemoteKeyStore, withRemoteKeyStoreAt } from "./extension.ts";
import { createLoopbackTransport } from "./loopback.ts";
import { createKeyStoreResponder } from "./server.ts";
import type { RemoteTransport } from "./types.ts";

/** A reactive store shaped like every keystore's. */
function newStore(): Store<KeyStoreState> {
  return new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
}

/**
 * The smallest keystore that still proves a mount is wired to *this* engine: it
 * publishes its keys into the given store and nothing else.
 */
function fakeKeyStore(store: Store<KeyStoreState>, label: string): MountedKeyStoreAPI {
  let counter = 0;
  return {
    ready: Promise.resolve().then(() => {
      store.setState((state) => ({
        ...state,
        algorithms: [{ algorithm: "EdDSA", source: "host" }],
      }));
    }),
    async generate(): Promise<KeyId> {
      counter += 1;
      const id = `${label}-${counter}`;
      store.setState((state) => ({
        ...state,
        keys: [
          ...state.keys,
          {
            id,
            type: "ed25519",
            algorithm: "EdDSA",
            extractable: false,
            keyUsages: ["sign"],
            version: 1,
          } satisfies Key,
        ],
      }));
      return id;
    },
    import: () => Promise.reject(new Error("not implemented")),
    export: () => Promise.reject(new Error("not implemented")),
    remove: () => Promise.resolve(),
    sign: () => Promise.resolve(new Uint8Array([1])),
    verify: () => Promise.resolve(true),
  } as unknown as MountedKeyStoreAPI;
}

/** A host to talk to: a fake keystore behind a responder, over loopback. */
function hostedTransport(label: string): RemoteTransport {
  const hostStore = newStore();
  return createLoopbackTransport(
    createKeyStoreResponder({
      keystore: fakeKeyStore(hostStore, label) as unknown as KeyStore<never>,
      store: hostStore,
    }),
  );
}

/** A stand-in for a platform extension: a local keystore at `key.store`. */
const WithLocalKeyStore: Extension<KeyStoreExtension> = (provider, options) => {
  const store = options.local.store as Store<KeyStoreState>;
  return createKeyStoreExtension({
    provider,
    store,
    keystore: fakeKeyStore(store, "local"),
  }) as KeyStoreExtension;
};

describe("WithRemoteKeyStore", () => {
  it("mounts at `key.store` by default", async () => {
    const RemoteProvider = Provider.withExtensions([WithRemoteKeyStore]);
    const store = newStore();
    const provider = new RemoteProvider(
      { id: "wallet", name: "Wallet" },
      { remote: { store, transport: hostedTransport("daemon") } },
    );

    await provider.key.store.ready;
    expect(provider.keys).toEqual([]);
    expect(provider.algorithms).toEqual([{ algorithm: "EdDSA", source: "host" }]);
  });

  it("honours the mount named in its options", async () => {
    const RemoteProvider = Provider.withExtensions([WithRemoteKeyStore]);
    const store = newStore();
    const provider = new RemoteProvider(
      { id: "wallet", name: "Wallet" },
      { remote: { store, transport: hostedTransport("daemon"), mount: "rpc" } },
    ) as unknown as { key: { rpc: { ready?: Promise<void> }; store?: unknown } };

    await provider.key.rpc.ready;
    expect(provider.key.store).toBeUndefined();
  });

  it("refuses to run without a transport", () => {
    const RemoteProvider = Provider.withExtensions([WithRemoteKeyStore]);
    expect(
      () => new RemoteProvider({ id: "wallet", name: "Wallet" }, { remote: { store: newStore() } }),
    ).toThrow(/requires a transport/);
  });

  it("says which configuration block it expected", () => {
    const RemoteProvider = Provider.withExtensions([WithRemoteKeyStore]);
    expect(() => new RemoteProvider({ id: "wallet", name: "Wallet" }, {})).toThrow(
      /no configuration/,
    );
  });
});

describe("withRemoteKeyStoreAt", () => {
  it("puts a named service beside the local keystore", async () => {
    const WalletProvider = Provider.withExtensions([
      WithLocalKeyStore,
      withRemoteKeyStoreAt("rpc.ows"),
    ]);

    const localStore = newStore();
    const remoteStore = newStore();
    const provider = new WalletProvider(
      { id: "wallet", name: "Wallet" },
      {
        local: { store: localStore },
        remote: { "rpc.ows": { store: remoteStore, transport: hostedTransport("ows") } },
      },
    );

    await provider.key.rpc.ows.ready;

    // Both keystores answer, each on its own name.
    const localId = await provider.key.store.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign"],
    });
    const remoteId = await provider.key.rpc.ows.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign"],
    });

    expect(localStore.state.keys.map((key: { id: KeyId }) => key.id)).toEqual([localId]);
    expect(remoteStore.state.keys.map((key: { id: KeyId }) => key.id)).toEqual([remoteId]);

    // The local keystore, mounted first, still owns the reactive state.
    expect(provider.keys.map((key) => key.id)).toEqual([localId]);
  });

  it("hosts several named services under one group", async () => {
    const WalletProvider = Provider.withExtensions([
      withRemoteKeyStoreAt("rpc.ows"),
      withRemoteKeyStoreAt("rpc.hsm"),
    ]);

    const provider = new WalletProvider(
      { id: "wallet", name: "Wallet" },
      {
        remote: {
          "rpc.ows": { store: newStore(), transport: hostedTransport("ows") },
          "rpc.hsm": { store: newStore(), transport: hostedTransport("hsm") },
        },
      },
    );

    await Promise.all([provider.key.rpc.ows.ready, provider.key.rpc.hsm.ready]);
    expect(provider.key.rpc.ows).not.toBe(provider.key.rpc.hsm);
  });

  it("refuses to take a name that is already answered", () => {
    const WalletProvider = Provider.withExtensions([
      WithLocalKeyStore,
      withRemoteKeyStoreAt("store"),
    ]);

    expect(
      () =>
        new WalletProvider(
          { id: "wallet", name: "Wallet" },
          {
            local: { store: newStore() },
            remote: { store: newStore(), transport: hostedTransport("daemon") },
          },
        ),
    ).toThrow(/already mounted/);
  });
});
