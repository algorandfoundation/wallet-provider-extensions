import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConnectionRpc,
  createConnectionsStore,
  createDomainRegistry,
  createSecureChannel,
  createSecureMessaging,
  defineDomain,
} from "@algorandfoundation/connections-core";
import type {
  ConnectionDomains,
  ConnectionMessage,
  ConnectionSession,
  ProtocolContext,
} from "@algorandfoundation/connections-core";

import { encodeAlgorandAddress } from "./address.ts";
import { LiquidAuthError } from "./errors.ts";
import { createMockSignaling } from "./mock.ts";
import {
  createLiquidAuthResponder,
  type LiquidAuthResponderOptions,
  type LiquidAuthenticateHelpers,
  type LiquidMessageActions,
} from "./responder.ts";
import type { LiquidSignalClient } from "./signaling.ts";
import { dataChannelTransport } from "./channel.ts";

const SIGNAL_URL = "https://liquid.example.com";
const REQUEST_URI = `liquid://liquid.example.com/?requestId=req-1`;

// The wallet key behind the authSigner; hosts may hand the responder
// either the canonical address or the base64 public key.
const WALLET_PUBLIC_KEY = new Uint8Array(32).fill(7);
const WALLET_ADDRESS = encodeAlgorandAddress(WALLET_PUBLIC_KEY);
const WALLET_PUBLIC_KEY_B64 = btoa(String.fromCharCode(...WALLET_PUBLIC_KEY));

function makeContext(domains?: ConnectionDomains): ProtocolContext {
  return {
    sessions: createConnectionsStore().api,
    ...(domains ? { domains: createDomainRegistry(domains) } : {}),
  };
}

function makeResponder(
  options: LiquidAuthResponderOptions,
  ctx: ProtocolContext = makeContext(),
): ReturnType<typeof createLiquidAuthResponder> {
  return createLiquidAuthResponder(options, ctx);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Liquid Auth responder", () => {
  it("accepts a liquid:// URI, attests with the authSigner, and answers the peer", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    // The host "has WebAuthn" (the mock client's attestation stands in
    // for the real ceremony).
    vi.stubGlobal("navigator", { credentials: { create: async () => null } });
    // The host keys accounts by the base64 public key, so the responder
    // must normalize it to the canonical address on the wire.
    const authSigner = vi.fn(async () => ({
      address: WALLET_PUBLIC_KEY_B64,
      signature: "c2ln",
    }));
    const responder = makeResponder(
      { createSignalClient: hub.createSignalClient, authSigner },
      ctx,
    );

    const accepted = responder.accept(REQUEST_URI);
    // The attestation runs before peering; then the dapp joins.
    await vi.waitFor(() => expect(hub.clients).toHaveLength(1));
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");

    const { sessionId, transport } = await accepted;
    expect(sessionId).toBe("req-1");
    expect(transport.state).toBe("open");
    expect(authSigner).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8Array), {
      origin: SIGNAL_URL,
      requestId: "req-1",
    });
    // The liquid extension payload carried the signature + room routing.
    expect(hub.clients[0].lastAttestation).toMatchObject({
      type: "algorand",
      requestId: "req-1",
      origin: SIGNAL_URL,
      address: WALLET_ADDRESS,
      signature: "c2ln",
    });
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connected" });
  });

  it("answers the wallet RPC from the engine's domain registry over the established transport", async () => {
    const hub = createMockSignaling();
    // The engine inferred the accounts domain from the provider surface
    // and threads its registry through the ProtocolContext.
    const ctx = makeContext([
      defineDomain({ id: "accounts", expose: () => [{ address: "WALLET", name: "Main" }] }),
    ]);
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authenticate: async (client) => {
          client.authenticated = true;
        },
        wallet: {
          signTransactions: async () => [],
          metadata: { name: "Test Wallet" },
        },
      },
      ctx,
    );

    const accepted = responder.accept(REQUEST_URI);
    const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    await accepted;

    const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
    const result = await dappRpc.request("connect", { metadata: { name: "Dapp" } });
    expect(result).toEqual({
      domains: { accounts: [{ address: "WALLET", name: "Main" }] },
      metadata: { name: "Test Wallet" },
    });
  });

  it("records the dapp's announced domains on the session and routes them to the registry", async () => {
    const hub = createMockSignaling();
    const receive = vi.fn();
    const ctx = makeContext([defineDomain({ id: "identities", receive })]);
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authenticate: async (client) => {
          client.authenticated = true;
        },
        wallet: {
          signTransactions: async () => [],
        },
      },
      ctx,
    );

    const accepted = responder.accept(REQUEST_URI);
    const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    await accepted;

    const identity = { address: "did:key:zDapp", did: "did:key:zDapp", type: "did:key" };
    const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
    await dappRpc.request("connect", {
      metadata: { name: "Dapp" },
      domains: { identities: [identity], unknown: [] },
    });

    // The inbound records reached the matching domain, scoped to the session.
    expect(receive).toHaveBeenCalledWith("req-1", [identity], undefined);
    // The wallet-side session persisted the peer's announcement.
    await vi.waitFor(async () => {
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({
        peer: {
          domains: { identities: [identity], unknown: [] },
          metadata: { name: "Dapp" },
        },
      });
    });
  });

  it("passes a fresh-pairing approval context to approveConnect on accept", async () => {
    const hub = createMockSignaling();
    const approveConnect = vi.fn(() => true);
    const responder = makeResponder({
      createSignalClient: hub.createSignalClient,
      authenticate: async (client) => {
        client.authenticated = true;
      },
      wallet: {
        signTransactions: async () => [],
        approveConnect,
      },
    });

    const accepted = responder.accept(REQUEST_URI);
    const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    await accepted;

    const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
    await dappRpc.request("connect", { metadata: { name: "Dapp" } });
    // A brand-new pairing prompts: the context marks it NOT resumed.
    expect(approveConnect).toHaveBeenCalledExactlyOnceWith(
      { metadata: { name: "Dapp" } },
      { sessionId: "req-1", resumed: false },
    );
  });

  it("re-accepting a known requestId keeps the session's creation time", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const createdAt = Date.now() - 60_000;
    await ctx.sessions.upsertSession({
      id: "req-1",
      origin: SIGNAL_URL,
      status: "disconnected",
      createdAt,
      updatedAt: createdAt,
    });
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authenticate: async (client) => {
          client.authenticated = true;
        },
      },
      ctx,
    );

    const accepted = responder.accept(REQUEST_URI);
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    await accepted;

    // The SAME session was renegotiated, not a new record minted.
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({
      status: "connected",
      createdAt,
    });
  });

  it("a stale transport closing after a re-accept does not clobber the connected status", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authenticate: async (client) => {
          client.authenticated = true;
        },
      },
      ctx,
    );

    const first = responder.accept(REQUEST_URI);
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    const { transport: stale } = await first;

    const second = responder.accept(REQUEST_URI);
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    const { transport: current } = await second;

    // The FIRST negotiation's transport closes late: bookkeeping noise.
    stale.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connected" });

    // The CURRENT transport closing still disconnects the session.
    current.close();
    await vi.waitFor(async () => {
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "disconnected" });
    });
  });

  it("throws a typed error when the host has no WebAuthn implementation", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    vi.stubGlobal("navigator", {});
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authSigner: async () => ({ address: "WALLET", signature: "c2ln" }),
      },
      ctx,
    );

    try {
      await responder.accept(REQUEST_URI);
      expect.unreachable("accept must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LiquidAuthError);
      expect((e as LiquidAuthError).code).toBe("webauthn_unavailable");
    }
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "failed" });
    expect(hub.clients[0].closed).toBe(true);
  });

  it("throws a typed error when no authSigner is configured", async () => {
    const hub = createMockSignaling();
    vi.stubGlobal("navigator", { credentials: { create: async () => null } });
    const responder = makeResponder({ createSignalClient: hub.createSignalClient });

    await expect(responder.accept(REQUEST_URI)).rejects.toMatchObject({
      code: "auth_signer_missing",
    });
  });

  it("rejects malformed URIs with a typed error", async () => {
    const responder = makeResponder({
      createSignalClient: createMockSignaling().createSignalClient,
    });

    await expect(responder.accept("https://not-liquid.example")).rejects.toMatchObject({
      code: "invalid_uri",
    });
  });

  it("marks the session failed when the attestation is refused", async () => {
    const hub = createMockSignaling({ attestationError: new Error("refused") });
    const ctx = makeContext();
    vi.stubGlobal("navigator", { credentials: { create: async () => null } });
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authSigner: async () => ({ address: "WALLET", signature: "c2ln" }),
      },
      ctx,
    );

    await expect(responder.accept(REQUEST_URI)).rejects.toThrowError("refused");
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "failed" });
  });

  it("hands assertion-options helpers to an authenticate override and fires onAssertionOptions", async () => {
    const hub = createMockSignaling();
    const optionsJson = {
      challenge: "Y2hhbGxlbmdl",
      rpId: "example.com",
      allowCredentials: [{ id: "cred-a", type: "public-key" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(optionsJson), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const onAssertionOptions = vi.fn();
    const authenticate = vi.fn(
      async (client: LiquidSignalClient, _uri: unknown, helpers?: LiquidAuthenticateHelpers) => {
        const assertionOptions = await helpers!.fetchAssertionOptions("cred-a");
        expect(assertionOptions.rpId).toBe("example.com");
        expect(assertionOptions.allowCredentials).toEqual([{ id: "cred-a", type: "public-key" }]);
        client.authenticated = true;
      },
    );
    const responder = makeResponder({
      createSignalClient: hub.createSignalClient,
      authenticate,
      onAssertionOptions,
    });

    const accepted = responder.accept(REQUEST_URI);
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    await accepted;

    expect(authenticate).toHaveBeenCalledOnce();
    // The helper POSTed the liquid-client assertion endpoint of the URI's origin.
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
      `${SIGNAL_URL}/assertion/request/cred-a`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
    // ... and forwarded the normalized options to the host seam.
    expect(onAssertionOptions).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ rpId: "example.com", raw: optionsJson }),
    );
  });

  it("transitions the session to disconnected when the channel closes", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const responder = makeResponder(
      {
        createSignalClient: hub.createSignalClient,
        authenticate: async (client) => {
          client.authenticated = true;
        },
      },
      ctx,
    );

    const accepted = responder.accept(REQUEST_URI);
    void hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
    const { transport } = await accepted;

    transport.close();
    await vi.waitFor(async () => {
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "disconnected" });
    });
  });

  describe("resume", () => {
    /** A previously-paired session, as the engine's store would carry it. */
    function makeSession(overrides: Record<string, unknown> = {}): ConnectionSession {
      const createdAt = Date.now() - 60_000;
      return {
        id: "req-1",
        origin: SIGNAL_URL,
        status: "disconnected",
        createdAt,
        updatedAt: createdAt,
        ...overrides,
      } as ConnectionSession;
    }

    it("re-authenticates, re-offers, and answers the wallet RPC over the resumed transport", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      // The host decides the signaling session is still valid: no ceremony.
      const authenticate = vi.fn(async (client: LiquidSignalClient) => {
        client.authenticated = true;
      });
      const responder = makeResponder(
        {
          createSignalClient: hub.createSignalClient,
          authenticate,
          wallet: {
            signTransactions: async () => [],
            metadata: { name: "Test Wallet" },
          },
        },
        ctx,
      );
      const session = makeSession();
      await ctx.sessions.upsertSession(session);

      const resumed = responder.resume!(session);
      await vi.waitFor(async () => {
        expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });
      });
      // The dapp is parked on the link rendezvous and answers the re-offer.
      const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");

      const { sessionId, transport } = await resumed;
      expect(sessionId).toBe("req-1");
      expect(transport.state).toBe("open");
      // authenticate ran against the URI reconstructed from the session.
      expect(authenticate).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { origin: SIGNAL_URL, requestId: "req-1" },
        expect.anything(),
      );
      // The wallet responder is attached to the resumed transport.
      const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
      const result = await dappRpc.request("connect", { metadata: { name: "Dapp" } });
      expect(result).toEqual({
        domains: {},
        metadata: { name: "Test Wallet" },
      });
      // The session is connected again, with its original creation time.
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({
        status: "connected",
        createdAt: session.createdAt,
      });
    });

    it("tags the resumed transport's connect handshake for auto-approval", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const approveConnect = vi.fn(() => true);
      const responder = makeResponder(
        {
          createSignalClient: hub.createSignalClient,
          authenticate: async (client) => {
            client.authenticated = true;
          },
          wallet: {
            signTransactions: async () => [],
            approveConnect,
          },
        },
        ctx,
      );
      const session = makeSession();
      await ctx.sessions.upsertSession(session);

      const resumed = responder.resume!(session);
      const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
      await resumed;

      const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
      await dappRpc.request("connect", { metadata: { name: "Dapp" } });
      // A resume renegotiates an already-approved pairing: the context
      // lets the host auto-approve instead of re-prompting the user,
      // even though the handshake lands after resume() resolved.
      expect(approveConnect).toHaveBeenCalledExactlyOnceWith(
        { metadata: { name: "Dapp" } },
        { sessionId: "req-1", resumed: true },
      );
    });

    it("marks the session failed and closes the client when re-authentication is refused", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const responder = makeResponder(
        {
          createSignalClient: hub.createSignalClient,
          authenticate: async () => {
            throw new Error("signaling session expired");
          },
        },
        ctx,
      );

      await expect(responder.resume!(makeSession())).rejects.toThrowError(
        "signaling session expired",
      );
      expect(hub.clients[0].closed).toBe(true);
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "failed" });
    });

    it("rejects sessions without an origin with a typed error", async () => {
      const responder = makeResponder({
        createSignalClient: createMockSignaling().createSignalClient,
      });

      await expect(responder.resume!(makeSession({ origin: "" }))).rejects.toMatchObject({
        code: "invalid_session",
      });
    });
  });

  describe("secure messaging seam", () => {
    // Both sides fold the SAME shared secret through the secure channel;
    // in production each derives it via X25519 against the other's
    // `keyAgreement` key; the seam only sees the resulting channel.
    const SHARED_SECRET = new Uint8Array(32).fill(42);
    const DAPP_IDENTITY = {
      address: "did:key:zDapp",
      did: "did:key:zDapp",
      didDocument: { id: "did:key:zDapp", keyAgreement: [] },
    };

    /** Boots a connected responder with the messaging seam and a dapp rpc. */
    async function establish(seam: {
      channel?: ReturnType<typeof vi.fn>;
      onMessage?: (message: ConnectionMessage, actions: LiquidMessageActions) => void;
      autoAcknowledge?: boolean;
    }) {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const channel =
        seam.channel ?? vi.fn(() => createSecureChannel({ sharedSecret: SHARED_SECRET }));
      const responder = makeResponder(
        {
          createSignalClient: hub.createSignalClient,
          authenticate: async (client) => {
            client.authenticated = true;
          },
          wallet: {
            signTransactions: async () => [],
          },
          messaging: {
            channel,
            onMessage: seam.onMessage,
            autoAcknowledge: seam.autoAcknowledge,
          },
        },
        ctx,
      );

      const accepted = responder.accept(REQUEST_URI);
      const dappChannel = hub.createSignalClient(SIGNAL_URL).peer("req-1", "offer");
      await accepted;

      const dappRpc = createConnectionRpc(dataChannelTransport(await dappChannel));
      // The dapp's own messaging half: same shared key, its own store.
      const dappStore = createConnectionsStore().api;
      const dappMessaging = createSecureMessaging({
        rpc: dappRpc,
        channel: createSecureChannel({ sharedSecret: SHARED_SECRET }),
        sessionId: "req-1",
        messages: dappStore,
      });
      dappMessaging.attach();
      return { ctx, channel, dappRpc, dappMessaging, dappStore };
    }

    it("derives the channel from the dapp's announced domains and answers `message`", async () => {
      const received: ConnectionMessage[] = [];
      const { ctx, channel, dappRpc, dappMessaging, dappStore } = await establish({
        onMessage: (message) => received.push(message),
      });

      await dappRpc.request("connect", {
        metadata: { name: "Dapp" },
        domains: { identities: [DAPP_IDENTITY] },
      });
      // The seam saw exactly what the dapp introduced.
      expect(channel).toHaveBeenCalledExactlyOnceWith({
        sessionId: "req-1",
        origin: SIGNAL_URL,
        domains: { identities: [DAPP_IDENTITY] },
        resumed: false,
      });

      const sent = await dappMessaging.send("hello over the shared key");
      expect(sent.status).toBe("delivered");
      // The wallet decrypted, surfaced, and persisted the message...
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        text: "hello over the shared key",
        direction: "incoming",
        sessionId: "req-1",
      });
      expect(await ctx.sessions.getMessage(sent.id)).toMatchObject({
        text: "hello over the shared key",
      });
      // ...and its default auto-ack upgrades the dapp's copy.
      await vi.waitFor(async () => {
        expect(await dappStore.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
      });
    });

    it("gates the ack on the host when autoAcknowledge is off", async () => {
      const alerts: { message: ConnectionMessage; actions: LiquidMessageActions }[] = [];
      const { ctx, dappRpc, dappMessaging, dappStore } = await establish({
        onMessage: (message, actions) => alerts.push({ message, actions }),
        autoAcknowledge: false,
      });
      await dappRpc.request("connect", { domains: { identities: [DAPP_IDENTITY] } });

      const sent = await dappMessaging.send("acknowledge me");
      expect(alerts).toHaveLength(1);
      // Delivered, but NOT acknowledged until the host (the user) acts.
      expect(await dappStore.getMessage(sent.id)).toMatchObject({ status: "delivered" });

      // The user confirms the alert; the action acks back to the dapp.
      await alerts[0].actions.acknowledge();
      expect(await ctx.sessions.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
      expect(await dappStore.getMessage(sent.id)).toMatchObject({ status: "acknowledged" });
    });

    it("rejects `message` with secure_channel_unavailable until a channel is derived", async () => {
      // The dapp announces no identity records the host can derive a key from.
      const { dappRpc, channel } = await establish({
        channel: vi.fn(() => null),
      });
      await dappRpc.request("connect", { metadata: { name: "Dapp" } });
      expect(channel).toHaveBeenCalledOnce();

      await expect(
        dappRpc.request("message", { id: "m-1", nonce: "AA", ciphertext: "AA" }),
      ).rejects.toMatchObject({ code: "secure_channel_unavailable" });
    });
  });
});
