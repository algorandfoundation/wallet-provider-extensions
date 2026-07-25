import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Store } from "@tanstack/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeKeyStore } from "../engine.ts";
import type { KeyringBinding } from "../storage/keyring.ts";
import type { MetadataFile } from "../storage/metadata.ts";
import { createRpcKeyStore, type RpcKeyStore } from "./client.ts";
import { createKeyStoreRpcServer, type KeyStoreRpcServer } from "./server.ts";
import {
  createFrameDecoder,
  decodeValue,
  encodeFrame,
  encodeValue,
  type RpcRequest,
} from "./protocol.ts";

/** A fresh in-memory OS-keychain fake (mirrors the CLI test harness). */
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

describe("keystore RPC protocol codec", () => {
  it("round-trips nested Uint8Array payloads through encode/decode", () => {
    const value = {
      id: "abc",
      signature: new Uint8Array([1, 2, 3, 250]),
      nested: [{ bytes: new Uint8Array([0, 255]) }],
      count: 7,
      flag: true,
    };
    const decoded = decodeValue(encodeValue(value)) as typeof value;
    expect(decoded.id).toBe("abc");
    expect(decoded.count).toBe(7);
    expect(decoded.flag).toBe(true);
    expect(Array.from(decoded.signature)).toEqual([1, 2, 3, 250]);
    expect(Array.from(decoded.nested[0].bytes)).toEqual([0, 255]);
  });

  it("frames and reassembles messages split across chunks", () => {
    const request: RpcRequest = { jsonrpc: "2.0", id: 1, method: "list", params: [] };
    const frame = encodeFrame(request);
    const decoder = createFrameDecoder();
    // Feed the frame in two arbitrary halves; only the completed line parses.
    const half = Math.floor(frame.length / 2);
    expect(decoder.push(frame.slice(0, half))).toEqual([]);
    const messages = decoder.push(frame.slice(half));
    expect(messages).toEqual([request]);
  });
});

describe("keystore RPC service + client engine", () => {
  let server: KeyStoreRpcServer;
  let client: RpcKeyStore;
  let clientStore: Store<KeyStoreState>;
  let socketPath: string;

  beforeEach(async () => {
    socketPath = join(
      tmpdir(),
      `ks-rpc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
    );

    // A single shared in-memory backend hosted behind the socket.
    const serverStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    const keystore = createNodeKeyStore({
      store: serverStore,
      keyring: memoryKeyring(),
      metadata: memoryMetadata(),
    });
    server = createKeyStoreRpcServer({ keystore, store: serverStore, path: socketPath });
    await server.listen();

    clientStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
    client = createRpcKeyStore({ store: clientStore, path: socketPath });
    await client.ready;
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("hydrates the client store with the server's capabilities on ready", () => {
    const algorithms = clientStore.state.algorithms ?? [];
    expect(algorithms.some((c) => c.source === "host")).toBe(true);
    expect(algorithms.some((c) => c.algorithm === "BIP32-Ed25519")).toBe(true);
  });

  it("forwards a full seed → root → account sign/verify lifecycle over the wire", async () => {
    const mnemonic = generateMnemonic(wordlist, 256);
    const seed = await mnemonicToSeed(mnemonic);
    const seedId = await client.importSeed!(seed, { name: "Wire Seed" });
    expect(typeof seedId).toBe("string");

    const rootKeyId = await client.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["deriveBits", "deriveKey"],
      params: { parentKeyId: seedId },
    });

    const accountId = await client.deriveFromSeed!(rootKeyId, "m/44'/283'/0'/0/0");

    const message = new TextEncoder().encode("hello over rpc");
    const signature = await client.sign(accountId, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBeGreaterThan(0);

    const valid = await client.verify(accountId, message, signature);
    expect(valid).toBe(true);

    const tampered = await client.verify(accountId, new TextEncoder().encode("nope"), signature);
    expect(tampered).toBe(false);

    // The client's reactive store is kept in sync via server state pushes.
    const ids = clientStore.state.keys.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining([seedId, rootKeyId, accountId]));
  });

  it("rejects with the server's error message when an operation throws", async () => {
    await expect(client.sign("does-not-exist", new Uint8Array([1]))).rejects.toThrow();
  });

  it("round-trips an ed25519 import with an explicit id and signs/verifies over rpc", async () => {
    const privateKey = new Uint8Array(32).map((_, i) => i + 1);
    const id = await client.import({
      id: "wire-ed25519",
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
      privateKey,
    });
    expect(id).toBe("wire-ed25519");

    const meta = clientStore.state.keys.find((k) => k.id === id);
    expect(meta?.type).toBe("ed25519");
    expect(meta?.publicKey).toBeInstanceOf(Uint8Array);

    const message = new TextEncoder().encode("hello import over rpc");
    const signature = await client.sign(id, message);
    expect(await client.verify(id, message, signature)).toBe(true);
  });

  it("reflects a remote clear in the client store", async () => {
    await client.generate({
      type: "ed25519",
      algorithm: "EdDSA",
      extractable: false,
      keyUsages: ["sign", "verify"],
    });
    expect(clientStore.state.keys.length).toBeGreaterThan(0);

    await client.clear!();
    expect(clientStore.state.keys.length).toBe(0);
  });
});
