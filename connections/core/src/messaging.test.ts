import { describe, expect, it, vi } from "vitest";

import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

import {
  createSecureChannel,
  edwardsToX25519PublicKey,
  keyAgreementPublicKey,
  x25519KeyPairFromEd25519Seed,
} from "./crypto.ts";
import { createConnectionsStore } from "./engine.ts";
import { ConnectionRpcError } from "./errors.ts";
import { createSecureMessaging } from "./messaging.ts";
import type { SecureMessaging, SecureMessagingOptions } from "./messaging.ts";
import { createConnectionRpc } from "./rpc.ts";
import { createInMemoryTransportPair } from "./transport.ts";
import type { ConnectionMessage, ConnectionsStoreApi } from "./types.ts";

const SEED_A = new Uint8Array(32).fill(7);
const SEED_B = new Uint8Array(32).fill(42);
const SESSION_ID = "session-1";

/** Builds the minimal DID document each side's identity would expose. */
function makeDidDocument(edPublicKey: Uint8Array): Record<string, any> {
  const prefixed = new Uint8Array(34);
  prefixed.set([0xed, 0x01]);
  prefixed.set(edPublicKey, 2);
  const did = `did:key:z${base58.encode(prefixed)}`;
  const xPrefixed = new Uint8Array(34);
  xPrefixed.set([0xec, 0x01]);
  xPrefixed.set(edwardsToX25519PublicKey(edPublicKey), 2);
  const multibase = `z${base58.encode(xPrefixed)}`;
  return {
    id: did,
    verificationMethod: [
      {
        id: `${did}#${multibase}`,
        type: "X25519KeyAgreementKey2020",
        controller: did,
        publicKeyMultibase: multibase,
      },
    ],
    keyAgreement: [`${did}#${multibase}`],
  };
}

interface Peer {
  messaging: SecureMessaging;
  api: ConnectionsStoreApi;
  received: ConnectionMessage[];
}

/**
 * Wires two peers exactly like a live session: transports paired in
 * memory, each side's channel derived from its OWN seed and the PEER's
 * DID document (as exchanged during `connect`).
 */
function makePeers(overrides: Partial<Pick<SecureMessagingOptions, "autoAcknowledge">> = {}): {
  a: Peer;
  b: Peer;
} {
  const { a: transportA, b: transportB } = createInMemoryTransportPair();
  const rpcA = createConnectionRpc(transportA);
  const rpcB = createConnectionRpc(transportB);

  const docA = makeDidDocument(ed25519.getPublicKey(SEED_A));
  const docB = makeDidDocument(ed25519.getPublicKey(SEED_B));

  const build = (
    rpc: ReturnType<typeof createConnectionRpc>,
    seed: Uint8Array,
    remoteDoc: Record<string, any>,
  ): Peer => {
    const { api } = createConnectionsStore();
    const received: ConnectionMessage[] = [];
    const channel = createSecureChannel({
      privateKey: x25519KeyPairFromEd25519Seed(seed).privateKey,
      remotePublicKey: keyAgreementPublicKey(remoteDoc)!,
    });
    const messaging = createSecureMessaging({
      rpc,
      channel,
      sessionId: SESSION_ID,
      messages: api,
      onMessage: (message) => received.push(message),
      ...overrides,
    });
    messaging.attach();
    return { messaging, api, received };
  };

  return { a: build(rpcA, SEED_A, docB), b: build(rpcB, SEED_B, docA) };
}

describe("createSecureMessaging", () => {
  it("delivers, persists, and auto-acknowledges a message on both sides", async () => {
    const { a, b } = makePeers();

    const sent = await a.messaging.send("hello over the shared key");
    expect(["delivered", "acknowledged"]).toContain(sent.status);
    expect(sent.direction).toBe("outgoing");

    // The receiver decrypted, persisted, and surfaced the plaintext.
    expect(b.received).toHaveLength(1);
    expect(b.received[0]).toMatchObject({
      id: sent.id,
      sessionId: SESSION_ID,
      direction: "incoming",
      text: "hello over the shared key",
    });

    // The auto-ack settles asynchronously: both sides converge on `acknowledged`.
    await vi.waitFor(async () => {
      expect(await a.api.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
      expect(await b.api.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
    });
  });

  it("supports an application-gated ack when autoAcknowledge is off", async () => {
    const { a, b } = makePeers({ autoAcknowledge: false });

    const sent = await a.messaging.send("read me later");
    expect(sent.status).toBe("delivered");
    expect(await b.api.getMessage(sent.id)).toMatchObject({ status: "received" });

    const acknowledged = await b.messaging.acknowledge(sent.id);
    expect(acknowledged).toMatchObject({ status: "acknowledged" });
    expect(await a.api.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
  });

  it("messages flow in both directions over the one channel", async () => {
    const { a, b } = makePeers({ autoAcknowledge: false });

    await a.messaging.send("ping");
    await b.messaging.send("pong");

    expect((await a.api.getMessages(SESSION_ID)).map((m) => m.direction)).toEqual([
      "outgoing",
      "incoming",
    ]);
    expect(a.received.map((m) => m.text)).toEqual(["pong"]);
    expect(b.received.map((m) => m.text)).toEqual(["ping"]);
  });

  it("rejects frames that do not open under the shared key", async () => {
    const { b } = makePeers();

    // A stranger's channel (wrong private key) seals a frame with the
    // right envelope shape; decryption must fail on the receiver.
    const stranger = createSecureChannel({
      privateKey: x25519KeyPairFromEd25519Seed(new Uint8Array(32).fill(99)).privateKey,
      remotePublicKey: x25519KeyPairFromEd25519Seed(SEED_B).publicKey,
    });
    const sealed = stranger.encrypt("forged");

    await expect(
      b.messaging.handle("message", { id: "forged-1", ...sealed }),
    ).rejects.toMatchObject({ code: "decrypt_failed" });

    expect(await b.api.getMessage("forged-1")).toBeUndefined();
  });

  it("marks the local message failed when the transport is gone", async () => {
    // Closing one end closes the pair; the request cannot travel.
    const { a: transport } = createInMemoryTransportPair();
    transport.close();

    const channel = createSecureChannel({
      privateKey: x25519KeyPairFromEd25519Seed(SEED_A).privateKey,
      remotePublicKey: x25519KeyPairFromEd25519Seed(SEED_B).publicKey,
    });
    const { api } = createConnectionsStore();
    const messaging = createSecureMessaging({
      rpc: createConnectionRpc(transport),
      channel,
      sessionId: SESSION_ID,
      messages: api,
    });

    await expect(messaging.send("into the void")).rejects.toMatchObject({
      code: "transport_closed",
    });
    const [message] = await api.getMessages(SESSION_ID);
    expect(message).toMatchObject({ status: "failed", direction: "outgoing" });
  });

  it("answers message_ack for unknown ids with unknown_message", async () => {
    const { b } = makePeers();
    await expect(b.messaging.handle("message_ack", { id: "nope" })).rejects.toMatchObject({
      code: "unknown_message",
    });
  });

  it("re-delivered ids are confirmed idempotently without duplicates", async () => {
    const { a, b } = makePeers({ autoAcknowledge: false });
    const sent = await a.messaging.send("once only");

    // Simulate the sender retrying the same frame (e.g. after a lost
    // response): the receiver confirms but stores nothing new.
    const sealedAgain = createSecureChannel({
      privateKey: x25519KeyPairFromEd25519Seed(SEED_A).privateKey,
      remotePublicKey: x25519KeyPairFromEd25519Seed(SEED_B).publicKey,
    }).encrypt("once only");
    const result = await b.messaging.handle("message", { id: sent.id, ...sealedAgain });

    expect(result).toMatchObject({ id: sent.id, received: true });
    expect(await b.api.getMessages(SESSION_ID)).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it("delegates non-messaging methods to the fallback handler", async () => {
    const { a: transportA, b: transportB } = createInMemoryTransportPair();
    const rpcA = createConnectionRpc(transportA);
    const rpcB = createConnectionRpc(transportB);

    const channel = (seed: Uint8Array, remoteSeed: Uint8Array) =>
      createSecureChannel({
        privateKey: x25519KeyPairFromEd25519Seed(seed).privateKey,
        remotePublicKey: x25519KeyPairFromEd25519Seed(remoteSeed).publicKey,
      });

    const { api } = createConnectionsStore();
    const messaging = createSecureMessaging({
      rpc: rpcB,
      channel: channel(SEED_B, SEED_A),
      sessionId: SESSION_ID,
      messages: api,
    });
    messaging.attach(async (method) => {
      if (method === "connect") return { accounts: [{ address: "ADDR" }] };
      throw new ConnectionRpcError("method_not_found", `unknown method ${method}`);
    });

    // The wallet responder's method still answers through the fallback…
    const result = await rpcA.request("connect", {});
    expect(result.accounts).toEqual([{ address: "ADDR" }]);

    // …while unknown methods keep failing with method_not_found.
    await expect(rpcA.request("no_such_method", {})).rejects.toMatchObject({
      code: "method_not_found",
    });
  });
});
