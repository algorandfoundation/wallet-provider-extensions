import type {
  GenerateOptions,
  Key,
  KeyId,
  KeyStore,
  KeyStoreState,
} from "@algorandfoundation/keystore-core";
import { Store } from "@tanstack/store";
import { beforeEach, describe, expect, it } from "vitest";

import { createRemoteKeyStore } from "./client.ts";
import { createLoopbackTransport } from "./loopback.ts";
import { createKeyStoreResponder } from "./server.ts";
import type { KeyStoreResponder, RemoteKeyStore } from "./types.ts";

/** A per-operation context, to prove one survives the wire. */
interface TestContext {
  passphrase?: string;
}

/** Records every context a call was made with, for the assertions below. */
const seenContexts: unknown[] = [];

/**
 * A tiny in-memory keystore: enough of the contract to exercise the whole
 * remote path (state pushes, byte payloads, contexts, thrown errors) without
 * dragging a real crypto backend into the pure package's tests.
 */
function fakeKeyStore(store: Store<KeyStoreState>): KeyStore<TestContext> {
  let counter = 0;
  const material = new Map<KeyId, number>();

  const publish = (): void => {
    store.setState((state) => ({
      ...state,
      keys: [...material.keys()].map(
        (id): Key => ({
          id,
          type: "ed25519",
          algorithm: "EdDSA",
          extractable: false,
          keyUsages: ["sign"],
          version: 1,
        }),
      ),
    }));
  };

  return {
    ready: Promise.resolve().then(() => {
      store.setState((state) => ({
        ...state,
        algorithms: [{ algorithm: "EdDSA", source: "host" }],
      }));
    }),
    async generate(_options: GenerateOptions, ctx?: TestContext): Promise<KeyId> {
      seenContexts.push(ctx);
      counter += 1;
      const id = `key-${counter}`;
      material.set(id, counter);
      publish();
      return id;
    },
    import: () => Promise.reject(new Error("not implemented")),
    export: () => Promise.reject(new Error("not implemented")),
    async remove(id: KeyId): Promise<void> {
      material.delete(id);
      publish();
    },
    async clear(): Promise<void> {
      material.clear();
      publish();
    },
    async sign(id: KeyId, data: Uint8Array, _algorithm?: string, ctx?: TestContext) {
      seenContexts.push(ctx);
      const seed = material.get(id);
      if (seed === undefined) throw new Error(`key not found: ${id}`);
      return Uint8Array.from(data, (byte) => (byte + seed) & 0xff);
    },
    async verify(id: KeyId, data: Uint8Array, signature: Uint8Array) {
      const seed = material.get(id);
      if (seed === undefined) throw new Error(`key not found: ${id}`);
      return signature.every((byte, index) => byte === (((data[index] as number) + seed) & 0xff));
    },
  };
}

describe("remote keystore over a loopback transport", () => {
  let hostStore: Store<KeyStoreState>;
  let clientStore: Store<KeyStoreState>;
  let responder: KeyStoreResponder;
  let client: RemoteKeyStore;

  beforeEach(async () => {
    seenContexts.length = 0;
    hostStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    clientStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    responder = createKeyStoreResponder({
      keystore: fakeKeyStore(hostStore) as KeyStore<never>,
      store: hostStore,
    });
    client = createRemoteKeyStore({
      store: clientStore,
      transport: createLoopbackTransport(responder),
    });
    await client.ready;
  });

  it("hydrates the client store from the host's first state push", () => {
    expect(clientStore.state.algorithms).toEqual([{ algorithm: "EdDSA", source: "host" }]);
  });

  it("forwards a call and carries byte payloads both ways", async () => {
    const id = await client.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign"],
    });
    const message = new TextEncoder().encode("hello");
    const signature = await client.sign(id, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(await client.verify(id, message, signature)).toBe(true);
  });

  it("keeps the client store in sync with host-side changes", async () => {
    const id = await client.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign"],
    });
    expect(clientStore.state.keys.map((key) => key.id)).toEqual([id]);

    await client.clear!();
    expect(clientStore.state.keys).toEqual([]);
  });

  it("carries the per-operation context to the hosted keystore", async () => {
    const id = await client.generate(
      { type: "ed25519", algorithm: "EdDSA", extractable: false, keyUsages: ["sign"] },
      { passphrase: "hunter2" },
    );
    await client.sign(id, new Uint8Array([1]), undefined, { passphrase: "hunter2" });
    expect(seenContexts).toEqual([{ passphrase: "hunter2" }, { passphrase: "hunter2" }]);
  });

  it("rejects with the host's message instead of swallowing a failure", async () => {
    await expect(client.sign("nope", new Uint8Array([1]))).rejects.toThrow("key not found: nope");
  });

  it("says so loudly when the hosted keystore lacks an optional operation", async () => {
    // The client always exposes the optional surface; the host decides.
    await expect(client.importSeed!(new Uint8Array(32))).rejects.toThrow(
      /not supported by this keystore/,
    );
    await expect(client.secrets!.list()).rejects.toThrow(/does not support secrets/);
  });

  it("rejects in-flight and subsequent calls once closed", async () => {
    await client.close();
    await expect(client.sign("key-1", new Uint8Array([1]))).rejects.toThrow(/closed/);
  });
});

describe("remote keystore client without a host", () => {
  it("rejects `ready` when the link never comes up", async () => {
    const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    const client = createRemoteKeyStore({
      store,
      transport: (handlers) => {
        queueMicrotask(() => handlers.close(new Error("connection refused")));
        return { send: () => undefined, close: () => undefined };
      },
    });
    await expect(client.ready).rejects.toThrow("connection refused");
  });
});
