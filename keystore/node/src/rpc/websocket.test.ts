import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import {
  createRemoteKeyStore,
  createWebSocketTransport,
} from "@algorandfoundation/keystore-remote";
import type { RemoteKeyStore } from "@algorandfoundation/keystore-remote";
import { Store } from "@tanstack/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeKeyStore } from "../engine.ts";
import type { KeyringBinding } from "../storage/keyring.ts";
import type { MetadataFile } from "../storage/metadata.ts";
import { createKeyStoreWebSocketServer, type KeyStoreWebSocketServer } from "./websocket.ts";

/** A fresh in-memory OS-keychain fake (mirrors the other test harnesses). */
function memoryKeyring(): KeyringBinding {
  const map = new Map<string, string>();
  return {
    get: (account) => (map.has(account) ? (map.get(account) as string) : null),
    set: (account, secret) => {
      map.set(account, secret);
    },
    delete: (account) => map.delete(account),
  };
}

/** A fresh in-memory sealed-metadata file fake. */
function memoryMetadata(): MetadataFile {
  let blob: Uint8Array | null = null;
  return {
    read: () => blob,
    write: (b) => {
      blob = b;
    },
    remove: () => {
      blob = null;
    },
  };
}

describe("keystore WebSocket service + remote client engine", () => {
  let server: KeyStoreWebSocketServer;
  let client: RemoteKeyStore;
  let clientStore: Store<KeyStoreState>;

  beforeEach(async () => {
    const serverStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    const keystore = createNodeKeyStore({
      store: serverStore,
      keyring: memoryKeyring(),
      metadata: memoryMetadata(),
    });
    // Port 0: let the OS pick a free one, so the suite never collides.
    server = createKeyStoreWebSocketServer({ keystore, store: serverStore, port: 0 });
    const url = await server.listen();
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);

    clientStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    client = createRemoteKeyStore({
      store: clientStore,
      transport: createWebSocketTransport({ url }),
    });
    await client.ready;
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("hydrates the client store with the daemon's capabilities on ready", () => {
    const algorithms = clientStore.state.algorithms ?? [];
    expect(algorithms.some((capability) => capability.algorithm === "BIP32-Ed25519")).toBe(true);
  });

  it("signs and verifies over the WebSocket, bytes intact", async () => {
    const id = await client.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    const message = new TextEncoder().encode("hello over websocket");
    const signature = await client.sign(id, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(await client.verify(id, message, signature)).toBe(true);
    expect(await client.verify(id, new TextEncoder().encode("nope"), signature)).toBe(false);
  });

  it("pushes daemon-side state changes to the remote store", async () => {
    const id = await client.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(clientStore.state.keys.map((key) => key.id)).toContain(id);

    await client.clear!();
    expect(clientStore.state.keys).toEqual([]);
  });

  it("rejects with the daemon's error message when an operation throws", async () => {
    await expect(client.sign("does-not-exist", new Uint8Array([1]))).rejects.toThrow();
  });
});

describe("keystore WebSocket service without a daemon", () => {
  it("rejects `ready` when nothing is listening", async () => {
    const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    const client = createRemoteKeyStore({
      store,
      // Port 1 is privileged and never served by this suite.
      transport: createWebSocketTransport({ url: "ws://127.0.0.1:1" }),
    });
    await expect(client.ready).rejects.toThrow();
    await client.close();
  });
});
