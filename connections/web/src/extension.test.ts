import { describe, expect, it, vi } from "vitest";

import {
  createConnectionRpc,
  createConnectionsStore,
  createDomainRegistry,
  createInMemoryTransportPair,
  createSecureChannel,
  createSecureMessaging,
  createWalletResponder,
  defineDomain,
  UnknownProtocolError,
  type ConnectionDomains,
  type ConnectionMessage,
  type ConnectionProtocol,
  type ConnectionSession,
  type ConnectionSessionStatus,
  type ConnectionTransport,
  type SecureMessaging,
} from "@algorandfoundation/connections-core";

import {
  WithConnections,
  type WebConnectionsExtension,
  type WebConnectionsOptions,
} from "./extension.ts";

/** Encodes bytes as standard base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** The account record type the stub wallet exposes (structural `Account`). */
interface StubAccount {
  address: string;
  name: string;
}

/**
 * A stub protocol: every establishment hands the requester one end of an
 * in-memory pair whose other end is answered by a wallet responder
 * exposing its domains through a registry.
 */
function stubProtocol(
  id = "stub",
  {
    connectRole = true,
    resumeRole = true,
    resumeError,
    walletDomains,
  }: {
    connectRole?: boolean;
    resumeRole?: boolean;
    resumeError?: Error;
    /** Extra wallet-side domains announced next to `accounts`. */
    walletDomains?: ConnectionDomains;
  } = {},
): {
  protocol: ConnectionProtocol;
  walletSides: ConnectionTransport[];
  accounts: StubAccount[];
  resumes: { count: number; statuses: (ConnectionSessionStatus | undefined)[] };
} {
  const walletSides: ConnectionTransport[] = [];
  const accounts: StubAccount[] = [{ address: "WALLET", name: "Main" }];
  const resumes: { count: number; statuses: (ConnectionSessionStatus | undefined)[] } = {
    count: 0,
    statuses: [],
  };
  let counter = 0;

  const pairWallet = (): ConnectionTransport => {
    const { a, b } = createInMemoryTransportPair();
    walletSides.push(b);
    createWalletResponder({
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: (): StubAccount[] => accounts }),
        ...(walletDomains ?? []),
      ]),
      signTransactions: async (txns, indexesToSign) =>
        txns.map((txn, i) =>
          (indexesToSign ?? txns.map((_, j) => j)).includes(i)
            ? new Uint8Array([...txn, 255])
            : null,
        ),
      metadata: { name: "Stub Wallet" },
    }).attach(createConnectionRpc(b));
    return a;
  };

  const establish = async (ctxSessions: {
    upsert: (id: string) => Promise<void>;
  }): Promise<{ sessionId: string; transport: ConnectionTransport }> => {
    const sessionId = `${id}-${++counter}`;
    await ctxSessions.upsert(sessionId);
    return { sessionId, transport: pairWallet() };
  };

  const protocol: ConnectionProtocol = {
    id,
    createRequester(ctx) {
      const upsert = async (sessionId: string): Promise<void> => {
        const now = Date.now();
        await ctx.sessions.upsertSession({
          id: sessionId,
          origin: "https://wallet.example",
          status: "connecting",
          createdAt: now,
          updatedAt: now,
        });
      };
      return {
        async createRequest() {
          const pending = establish({ upsert });
          return {
            id: `${id}-${counter + 1}`,
            uri: `${id}://request`,
            qrData: `${id}://request`,
            establish: async () => (await pending).transport,
          };
        },
        ...(connectRole
          ? {
              connect: async () => establish({ upsert }),
            }
          : {}),
        ...(resumeRole
          ? {
              resume: async (session: ConnectionSession): Promise<ConnectionTransport> => {
                resumes.count++;
                resumes.statuses.push((await ctx.sessions.getSession(session.id))?.status);
                if (resumeError) throw resumeError;
                return pairWallet();
              },
            }
          : {}),
      };
    },
  };
  return { protocol, walletSides, accounts, resumes };
}

function mount(
  protocols: ConnectionProtocol[],
  extra: Omit<NonNullable<WebConnectionsOptions["connections"]>, "protocols"> = {},
  provider: Record<string, any> = {},
): WebConnectionsExtension {
  // The extension reads `log` and (for domain discovery) the extension
  // surfaces from the provider seam.
  return WithConnections(provider as any, {
    connections: { protocols, ...extra },
  }) as WebConnectionsExtension;
}

describe("Web WithConnections", () => {
  it("routes connect(protocolId) through the registered protocol and completes the handshake", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    const session = await ext.connection.connect("stub");

    expect(session.status).toBe("connected");
    expect(session.peer).toEqual({
      domains: { accounts: [{ address: "WALLET", name: "Main" }] },
      metadata: { name: "Stub Wallet" },
    });
    expect(ext.connections).toHaveLength(1);
    expect(ext.connections[0]).toMatchObject({ id: session.id, status: "connected" });
  });

  it("records every domain the wallet announces on the session", async () => {
    const identities = [
      { address: "did:key:zIDENTITY", did: "did:key:zIDENTITY", type: "did:key" },
    ];
    const passkeys = [{ credentialId: "cred-id-1", rpId: "dapp.example", userName: "main" }];
    const { protocol } = stubProtocol("stub", {
      walletDomains: [
        defineDomain({ id: "identities", expose: () => identities }),
        defineDomain({ id: "passkeys", expose: () => passkeys }),
        defineDomain({ id: "credentials" }), // announce-only
      ],
    });
    const ext = mount([protocol]);

    const session = await ext.connection.connect("stub");

    expect(session.peer).toEqual({
      domains: {
        accounts: [{ address: "WALLET", name: "Main" }],
        identities,
        passkeys,
        credentials: [],
      },
      metadata: { name: "Stub Wallet" },
    });
  });

  it("infers the dapp's domains from the provider surface (zero-config)", async () => {
    const { protocol } = stubProtocol();
    const receive = vi.fn();
    const revoke = vi.fn();
    const provider: Record<string, any> = {};
    const ext = mount([protocol], {}, provider);

    // The store extension mounts AFTER the connections engine; discovery
    // is lazy, so the domain is still announced and fed.
    provider.identity = {
      store: {},
      remote: {
        expose: () => [{ address: "did:key:zDAPP", type: "did:key" }],
        receive,
        revoke,
      },
    };

    const session = await ext.connection.connect("stub");

    // The peer's matching records were routed into the mounted store's
    // mirror with the session-routed signer context threaded through.
    expect(receive).not.toHaveBeenCalled(); // the stub wallet announced no identities
    expect(session.peer?.domains.accounts).toEqual([{ address: "WALLET", name: "Main" }]);

    await ext.connection.disconnect(session.id);
    expect(revoke).toHaveBeenCalledWith(session.id);
  });

  it("degrades to announce-only before the domain's connections bridge mounts, exchanging once it has", async () => {
    const { protocol } = stubProtocol();
    const expose = vi.fn(() => [{ address: "did:key:zDAPP", type: "did:key" }]);
    // The identity STORE is mounted, but the bridge's remote mirror is
    // not attached yet (the metas load it via a dynamic import).
    const provider: Record<string, any> = { identity: { store: {} } };
    const ext = mount([protocol], {}, provider);

    // A handshake racing the bridge import: the domain is announced with
    // an empty exchange (announce-only) and nothing crashes.
    const first = await ext.connection.connect("stub");
    expect(first.status).toBe("connected");
    expect(expose).not.toHaveBeenCalled();

    // The bridge lands: what `await provider.identity.store.ready`
    // guarantees applications before connecting. Discovery probes per
    // handshake, so the next connect exchanges the records.
    provider.identity.remote = { expose };
    const second = await ext.connection.connect("stub");
    expect(second.status).toBe("connected");
    expect(expose).toHaveBeenCalled();
  });

  it("routes the wallet's records into the mounted domain stores with a session-routed signer", async () => {
    const { protocol } = stubProtocol();
    const received: { records: StubAccount[]; sign?: (record: unknown) => unknown }[] = [];
    let attachedSign: ((txns: Uint8Array[]) => Promise<Uint8Array[]>) | undefined;
    const provider: Record<string, any> = {
      account: {
        store: {},
        remote: {
          receive: (
            _sessionId: string,
            records: StubAccount[],
            context?: { sign?: (record: unknown) => (txns: Uint8Array[]) => Promise<Uint8Array[]> },
          ) => {
            received.push({ records, sign: context?.sign });
            attachedSign = context?.sign?.(records[0]);
          },
        },
      },
    };
    const ext = mount([protocol], {}, provider);

    await ext.connection.connect("stub");

    expect(received).toHaveLength(1);
    expect(received[0].records).toEqual([{ address: "WALLET", name: "Main" }]);
    // The attached signer targets the connection's sign_transactions RPC.
    const signed = await attachedSign!([new Uint8Array([7])]);
    expect(signed).toEqual([new Uint8Array([7, 255])]);
  });

  it("prefers an explicit domains option over provider-surface inference", async () => {
    const { protocol } = stubProtocol();
    const surfaceExpose = vi.fn(() => [{ credentialId: "surface" }]);
    const provider: Record<string, any> = {
      passkey: { store: {}, remote: { expose: surfaceExpose } },
    };
    const explicitReceive = vi.fn();
    const ext = mount(
      [protocol],
      {
        domains: [
          defineDomain<"accounts", StubAccount>({ id: "accounts", receive: explicitReceive }),
        ],
      },
      provider,
    );

    const session = await ext.connection.connect("stub");

    // The inferred passkeys domain was overridden away...
    expect(surfaceExpose).not.toHaveBeenCalled();
    // ...and the explicit accounts domain received the wallet's records.
    expect(explicitReceive).toHaveBeenCalledWith(
      session.id,
      [{ address: "WALLET", name: "Main" }],
      expect.anything(),
    );
  });

  it("a throwing domain receive does not fail the handshake", async () => {
    const { protocol } = stubProtocol();
    const provider: Record<string, any> = {
      account: {
        store: {},
        remote: {
          receive: () => {
            throw new Error("store unavailable");
          },
        },
      },
    };
    const ext = mount([protocol], {}, provider);

    const session = await ext.connection.connect("stub");

    expect(session.status).toBe("connected");
  });

  it("revokes the session's domain mirrors when the transport closes from the wallet side", async () => {
    const { protocol, walletSides } = stubProtocol();
    const revoke = vi.fn();
    const provider: Record<string, any> = {
      account: { store: {}, remote: { receive: () => {}, revoke } },
    };
    const ext = mount([protocol], {}, provider);
    const session = await ext.connection.connect("stub");

    walletSides[0].close();

    await vi.waitFor(async () => {
      expect(await ext.connection.store.getSession(session.id)).toMatchObject({
        status: "disconnected",
      });
      expect(revoke).toHaveBeenCalledWith(session.id);
    });
  });

  it("a stale transport closing after a resume does not revoke the fresh session's records", async () => {
    const { protocol, walletSides } = stubProtocol();
    const revoke = vi.fn();
    const provider: Record<string, any> = {
      account: { store: {}, remote: { receive: () => {}, revoke } },
    };
    const ext = mount([protocol], {}, provider);
    const session = await ext.connection.connect("stub");

    await ext.connection.resume(session.id);

    // The wallet side of the FIRST negotiation closes late.
    walletSides[0].close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(revoke).not.toHaveBeenCalled();
    expect(await ext.connection.store.getSession(session.id)).toMatchObject({
      status: "connected",
    });
  });

  it("throws a typed error for unknown protocol ids", async () => {
    const ext = mount([]);

    await expect(ext.connection.connect("walletconnect")).rejects.toBeInstanceOf(
      UnknownProtocolError,
    );
  });

  it("falls back to createRequest + establish when the protocol has no connect()", async () => {
    const { protocol } = stubProtocol("qr-only", { connectRole: false });
    const ext = mount([protocol]);
    const onFallback = vi.fn();

    const session = await ext.connection.connect("qr-only", { onFallback });

    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback.mock.calls[0][0]).toMatchObject({ uri: "qr-only://request" });
    expect(session.status).toBe("connected");
  });

  it("createRequest wraps establish with the handshake", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    const request = await ext.connection.createRequest("stub");
    expect(request.qrData).toBe("stub://request");

    const transport = await request.establish();
    expect(transport.state).toBe("open");
    const session = await ext.connection.store.getSession(request.id);
    expect(session).toMatchObject({
      status: "connected",
      peer: { domains: { accounts: [{ address: "WALLET", name: "Main" }] } },
    });
  });

  it("routes signTransactions through the session's live rpc", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    const txns = [new Uint8Array([1]), new Uint8Array([2])].map(bytesToBase64);
    const stxns = await ext.connection.signTransactions(session.id, txns, [1]);

    expect(stxns).toEqual([null, bytesToBase64(new Uint8Array([2, 255]))]);
  });

  it("rejects signTransactions for sessions without a live connection", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    await expect(ext.connection.signTransactions("nope", [])).rejects.toMatchObject({
      code: "transport_closed",
    });
  });

  it("disconnect closes the rpc and marks the session disconnected", async () => {
    const { protocol, walletSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    await ext.connection.disconnect(session.id);

    expect(await ext.connection.store.getSession(session.id)).toMatchObject({
      status: "disconnected",
    });
    expect(walletSides[0].state).toBe("closed");
    await expect(ext.connection.signTransactions(session.id, [])).rejects.toMatchObject({
      code: "transport_closed",
    });
  });

  it("drops the live rpc when the transport closes from the wallet side", async () => {
    const { protocol, walletSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    walletSides[0].close();

    await expect(ext.connection.signTransactions(session.id, [])).rejects.toMatchObject({
      code: "transport_closed",
    });
  });

  it("marks the session disconnected when the transport closes from the wallet side", async () => {
    const { protocol, walletSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    walletSides[0].close();

    await vi.waitFor(async () => {
      expect(await ext.connection.store.getSession(session.id)).toMatchObject({
        status: "disconnected",
      });
    });
  });

  it("resume renegotiates over the protocol and re-runs the handshake", async () => {
    const { protocol, accounts, resumes } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");
    await ext.connection.disconnect(session.id);

    // The wallet exposes a fresh account list by the time it re-offers.
    accounts[0] = { address: "WALLET", name: "Renamed" };
    const resumed = await ext.connection.resume(session.id);

    expect(resumes.count).toBe(1);
    // The session was parked as `connecting` before the renegotiation.
    expect(resumes.statuses).toEqual(["connecting"]);
    expect(resumed.status).toBe("connected");
    expect(resumed.peer?.domains.accounts).toEqual([{ address: "WALLET", name: "Renamed" }]);
    expect(resumed.createdAt).toBe(session.createdAt);

    // The handshake re-ran and the new transport carries a live rpc.
    const txns = [bytesToBase64(new Uint8Array([7]))];
    await expect(ext.connection.signTransactions(session.id, txns)).resolves.toEqual([
      bytesToBase64(new Uint8Array([7, 255])),
    ]);
  });

  it("shares a single in-flight resume across concurrent calls", async () => {
    const { protocol, resumes } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");
    await ext.connection.disconnect(session.id);

    const [first, second] = await Promise.all([
      ext.connection.resume(session.id),
      ext.connection.resume(session.id),
    ]);

    expect(resumes.count).toBe(1);
    expect(first).toEqual(second);
  });

  it("rejects resume when the protocol does not implement it", async () => {
    const { protocol } = stubProtocol("stub", { resumeRole: false });
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    await expect(ext.connection.resume(session.id)).rejects.toThrow(
      "protocol stub does not implement resume",
    );
  });

  it("rejects resume for unknown sessions", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    await expect(ext.connection.resume("ghost")).rejects.toThrow("no session ghost to resume");
  });

  it("marks the session disconnected when resume fails", async () => {
    const { protocol } = stubProtocol("stub", { resumeError: new Error("signaling lost") });
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");
    await ext.connection.disconnect(session.id);

    await expect(ext.connection.resume(session.id)).rejects.toThrow("signaling lost");
    expect(await ext.connection.store.getSession(session.id)).toMatchObject({
      status: "disconnected",
    });
  });

  it("a stale transport closing after resume does not clobber the connected status", async () => {
    const { protocol, walletSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.connect("stub");

    const resumed = await ext.connection.resume(session.id);
    expect(resumed.status).toBe("connected");

    // The wallet side of the FIRST negotiation closes late.
    walletSides[0].close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await ext.connection.store.getSession(session.id)).toMatchObject({
      status: "connected",
    });
    // The resumed rpc is still live.
    await expect(ext.connection.signTransactions(session.id, [])).resolves.toEqual([]);
  });

  describe("secure messaging", () => {
    // Both sides fold the SAME shared secret through their channel; in
    // production each derives it via X25519 against the peer's
    // `keyAgreement` key.
    const SHARED_SECRET = new Uint8Array(32).fill(9);

    /**
     * A protocol whose wallet side composes the responder with its own
     * secure-messaging half (same shared key, its own store) and
     * records every `connect` params it answers.
     */
    function messagingProtocol() {
      const connectParams: unknown[] = [];
      const walletStore = createConnectionsStore().api;
      const walletMessagings: SecureMessaging[] = [];
      let counter = 0;

      const pairWallet = (sessionId: string): ConnectionTransport => {
        const { a, b } = createInMemoryTransportPair();
        const rpc = createConnectionRpc(b);
        const responder = createWalletResponder({
          domains: createDomainRegistry([
            defineDomain({
              id: "accounts",
              expose: (): StubAccount[] => [{ address: "WALLET", name: "Main" }],
            }),
          ]),
          signTransactions: async () => [],
        });
        const messaging = createSecureMessaging({
          rpc,
          channel: createSecureChannel({ sharedSecret: SHARED_SECRET }),
          sessionId,
          messages: walletStore,
        });
        walletMessagings.push(messaging);
        messaging.attach((method, params) => {
          if (method === "connect") connectParams.push(params);
          return responder.handle(method, params);
        });
        return a;
      };

      const protocol: ConnectionProtocol = {
        id: "msg",
        createRequester(ctx) {
          const upsert = async (sessionId: string): Promise<void> => {
            const now = Date.now();
            await ctx.sessions.upsertSession({
              id: sessionId,
              origin: "https://wallet.example",
              status: "connecting",
              createdAt: now,
              updatedAt: now,
            });
          };
          return {
            async connect() {
              const sessionId = `msg-${++counter}`;
              await upsert(sessionId);
              return { sessionId, transport: pairWallet(sessionId) };
            },
            async resume(session: ConnectionSession) {
              return pairWallet(session.id);
            },
          };
        },
      };
      return { protocol, connectParams, walletStore, walletMessagings };
    }

    it("announces the dapp's identities domain with the connect handshake", async () => {
      const identities = [{ address: "did:key:zDapp", did: "did:key:zDapp", type: "did:key" }];
      const { protocol, connectParams } = messagingProtocol();
      const ext = mount([protocol], {
        domains: [defineDomain({ id: "identities", expose: () => identities })],
      });

      await ext.connection.connect("msg");

      expect(connectParams).toEqual([{ domains: { identities } }]);
    });

    it("round-trips messages over the enabled channel, in both directions", async () => {
      const { protocol, walletStore, walletMessagings } = messagingProtocol();
      const ext = mount([protocol]);
      const session = await ext.connection.connect("msg");

      const received: ConnectionMessage[] = [];
      ext.connection.enableSecureMessaging(session.id, {
        channel: createSecureChannel({ sharedSecret: SHARED_SECRET }),
        onMessage: (message) => received.push(message),
      });

      // Dapp → wallet: delivered, persisted on both sides, auto-acked.
      const sent = await ext.connection.sendSecureMessage(session.id, "hello wallet");
      expect(sent.status).toBe("delivered");
      expect(await walletStore.getMessage(sent.id)).toMatchObject({
        text: "hello wallet",
        direction: "incoming",
      });
      await vi.waitFor(async () => {
        expect(await ext.connection.store.getMessage(sent.id)).toMatchObject({
          status: "acknowledged",
        });
      });

      // Wallet → dapp: the enabled channel answers and surfaces it.
      const back = await walletMessagings[0].send("hello dapp");
      expect(back.status).toBe("delivered");
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ text: "hello dapp", direction: "incoming" });
    });

    it("rejects sendSecureMessage until messaging is enabled", async () => {
      const { protocol } = messagingProtocol();
      const ext = mount([protocol]);
      const session = await ext.connection.connect("msg");

      await expect(ext.connection.sendSecureMessage(session.id, "hi")).rejects.toMatchObject({
        code: "secure_channel_unavailable",
      });
    });

    it("re-attaches the messaging layer after a resume replaces the transport", async () => {
      const { protocol, walletStore } = messagingProtocol();
      const ext = mount([protocol]);
      const session = await ext.connection.connect("msg");
      ext.connection.enableSecureMessaging(session.id, {
        channel: createSecureChannel({ sharedSecret: SHARED_SECRET }),
      });

      await ext.connection.disconnect(session.id);
      await expect(ext.connection.sendSecureMessage(session.id, "hi")).rejects.toMatchObject({
        code: "secure_channel_unavailable",
      });

      await ext.connection.resume(session.id);
      const sent = await ext.connection.sendSecureMessage(session.id, "back again");
      expect(sent.status).toBe("delivered");
      expect(await walletStore.getMessage(sent.id)).toMatchObject({ text: "back again" });
    });
  });
});
