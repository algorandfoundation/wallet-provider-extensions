import { describe, expect, it } from "vitest";

import {
  createConnectionRpc,
  createConnectionsStore,
  createDomainRegistry,
  defineDomain,
} from "@algorandfoundation/connections-core";

import { liquidAuth, LIQUID_AUTH_PROTOCOL_ID } from "./index.ts";
import { createMockSignaling } from "./mock.ts";

const URL = "https://liquid.example.com";

// An identity record as wallet hosts expose it over the connect
// handshake's `domains.identities` (the identity store's record minus
// its `sign`): the did:key identifier plus the W3C DID document (the
// shape the keystore-bridged identity stores produce), with signers
// already stripped. It must survive the JSON round-trip over the
// negotiated channel intact.
const WALLET_DID = "did:key:z6MkexampleWalletIdentity";
const WALLET_IDENTITY = {
  address: WALLET_DID,
  did: WALLET_DID,
  didDocument: {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: WALLET_DID,
    verificationMethod: [
      {
        id: `${WALLET_DID}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: WALLET_DID,
        publicKeyMultibase: "z6MkexampleWalletIdentity",
        metadata: { context: 1, account: 0, index: 0, derivation: 9 },
      },
    ],
    authentication: [`${WALLET_DID}#key-1`],
    assertionMethod: [`${WALLET_DID}#key-1`],
    service: [],
  },
  type: "did:key",
};

/** Encodes bytes as standard base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe("liquidAuth protocol plug-in", () => {
  it("registers under liquid-auth with both roles when a url is set", () => {
    const engine = createConnectionsStore({ protocols: [liquidAuth({ url: URL })] });
    const protocol = engine.protocols.get(LIQUID_AUTH_PROTOCOL_ID);

    expect(protocol.createRequester).toBeDefined();
    expect(protocol.createResponder).toBeDefined();
  });

  it("offers only the responder role without a url", () => {
    const protocol = liquidAuth();

    expect(protocol.createRequester).toBeUndefined();
    expect(protocol.createResponder).toBeDefined();
  });

  it("connects over the QR path and signs transactions end-to-end", async () => {
    const hub = createMockSignaling();

    // Wallet side: responder engine with the wallet seams. The domains
    // ride the ProtocolContext, as the hosting engine would infer them
    // from the provider surface.
    const walletEngine = createConnectionsStore({
      protocols: [
        liquidAuth({
          createSignalClient: hub.createSignalClient,
          authenticate: async (client) => {
            client.authenticated = true;
          },
          wallet: {
            signTransactions: async (txns, indexesToSign) =>
              txns.map((txn, i) =>
                (indexesToSign ?? txns.map((_, j) => j)).includes(i)
                  ? new Uint8Array([...txn, 255])
                  : null,
              ),
            metadata: { name: "Test Wallet" },
          },
        }),
      ],
    });
    const walletResponder = walletEngine.protocols.createResponder(LIQUID_AUTH_PROTOCOL_ID, {
      sessions: walletEngine.api,
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: () => [{ address: "WALLET", name: "Main" }] }),
        defineDomain({ id: "identities", expose: () => [WALLET_IDENTITY] }),
      ]),
    });

    // Dapp side: requester engine.
    const dappEngine = createConnectionsStore({
      protocols: [
        liquidAuth({
          url: URL,
          createSignalClient: hub.createSignalClient,
          generateRequestId: () => "req-e2e",
        }),
      ],
    });
    const dappRequester = dappEngine.protocols.createRequester(LIQUID_AUTH_PROTOCOL_ID, {
      sessions: dappEngine.api,
    });

    // The dapp renders the request's QR; the wallet scans and accepts it.
    const request = await dappRequester.createRequest();
    expect(request.qrData).toBe("liquid://liquid.example.com/?requestId=req-e2e");
    const [transport, { sessionId }] = await Promise.all([
      request.establish(),
      walletResponder.accept(request.uri!),
    ]);
    expect(sessionId).toBe("req-e2e");

    const rpc = createConnectionRpc(transport);

    // connect: the wallet's identity records ride the handshake in the
    // domains map next to its accounts, DID document and all, intact
    // after the wire round-trip.
    const connectResult = await rpc.request("connect", { metadata: { name: "Dapp" } });
    expect(connectResult).toEqual({
      domains: {
        accounts: [{ address: "WALLET", name: "Main" }],
        identities: [WALLET_IDENTITY],
      },
      metadata: { name: "Test Wallet" },
    });

    // sign_transactions with mixed signed/unsigned routing
    const txns = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    const signResult = await rpc.request("sign_transactions", {
      txns: txns.map(bytesToBase64),
      indexesToSign: [0, 2],
    });
    expect(signResult).toEqual({
      stxns: [
        bytesToBase64(new Uint8Array([1, 255])),
        null,
        bytesToBase64(new Uint8Array([3, 255])),
      ],
    });

    // Both engines track the session.
    expect(await dappEngine.api.getSession("req-e2e")).toBeDefined();
    expect(await walletEngine.api.getSession("req-e2e")).toMatchObject({ status: "connected" });
  });

  it("resumes a paired session and signs over the renegotiated transport", async () => {
    const hub = createMockSignaling();

    const walletEngine = createConnectionsStore();
    const walletResponder = liquidAuth({
      createSignalClient: hub.createSignalClient,
      authenticate: async (client) => {
        client.authenticated = true;
      },
      wallet: {
        signTransactions: async (txns) => txns.map((txn) => new Uint8Array([...txn, 255])),
        metadata: { name: "Test Wallet" },
      },
    }).createResponder!({
      sessions: walletEngine.api,
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: () => [{ address: "WALLET", name: "Main" }] }),
      ]),
    });

    const dappEngine = createConnectionsStore();
    const dappRequester = liquidAuth({
      url: URL,
      createSignalClient: hub.createSignalClient,
      generateRequestId: () => "req-resume",
    }).createRequester!({ sessions: dappEngine.api });

    // First pairing over the QR path.
    const request = await dappRequester.createRequest();
    const [transport, { transport: walletTransport }] = await Promise.all([
      request.establish(),
      walletResponder.accept(request.uri!),
    ]);

    // The connection drops: both ends of the channel close.
    transport.close();
    walletTransport.close();

    // Either party can initiate: the dapp parks on the link rendezvous,
    // the wallet re-authenticates (no ceremony) and re-sends its offer.
    const dappSession = (await dappEngine.api.getSession("req-resume"))!;
    const walletSession = (await walletEngine.api.getSession("req-resume"))!;
    const [resumedTransport, resumedConnection] = await Promise.all([
      dappRequester.resume!(dappSession),
      walletResponder.resume!(walletSession),
    ]);
    expect(resumedConnection.sessionId).toBe("req-resume");
    expect(resumedTransport.state).toBe("open");

    // The wallet RPC answers over the RESUMED transport.
    const rpc = createConnectionRpc(resumedTransport);
    const signResult = await rpc.request("sign_transactions", {
      txns: [bytesToBase64(new Uint8Array([9]))],
    });
    expect(signResult).toEqual({ stxns: [bytesToBase64(new Uint8Array([9, 255]))] });

    // Both engines converge on connected, keeping the original session.
    expect(await dappEngine.api.getSession("req-resume")).toMatchObject({
      status: "connected",
      createdAt: dappSession.createdAt,
    });
    expect(await walletEngine.api.getSession("req-resume")).toMatchObject({
      status: "connected",
      createdAt: walletSession.createdAt,
    });
  });

  it("surfaces a sign denial as a rejected rpc error", async () => {
    const hub = createMockSignaling();
    const walletEngine = createConnectionsStore();
    const responder = liquidAuth({
      createSignalClient: hub.createSignalClient,
      authenticate: async (client) => {
        client.authenticated = true;
      },
      wallet: {
        signTransactions: async () => [],
        approveSignTransactions: () => false,
      },
    }).createResponder!({ sessions: walletEngine.api });

    const dappEngine = createConnectionsStore();
    const requester = liquidAuth({
      url: URL,
      createSignalClient: hub.createSignalClient,
      generateRequestId: () => "req-deny",
    }).createRequester!({ sessions: dappEngine.api });

    const request = await requester.createRequest();
    const [transport] = await Promise.all([
      request.establish(),
      responder.accept(`liquid://liquid.example.com/?requestId=req-deny`),
    ]);
    const rpc = createConnectionRpc(transport);

    await expect(rpc.request("sign_transactions", { txns: [] })).rejects.toMatchObject({
      code: "rejected",
    });
  });
});
