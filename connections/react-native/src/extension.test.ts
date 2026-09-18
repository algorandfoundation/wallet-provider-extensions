import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryTransportPair,
  defineDomain,
  UnknownProtocolError,
  type ConnectionProtocol,
  type ConnectionSession,
  type ConnectionTransport,
  type EstablishedConnection,
  type ProtocolContext,
} from "@algorandfoundation/connections-core";

import {
  WithConnections,
  type ReactNativeConnectionsExtension,
  type ReactNativeConnectionsOptions,
} from "./extension.ts";

/**
 * A stub responder protocol tracking sessions like a real one would.
 */
function stubProtocol(
  id = "stub",
  { resumeRole = true }: { resumeRole?: boolean } = {},
): {
  protocol: ConnectionProtocol;
  accepted: string[];
  resumed: string[];
  peerSides: ConnectionTransport[];
} {
  const accepted: string[] = [];
  const resumed: string[] = [];
  const peerSides: ConnectionTransport[] = [];

  const establish = async (
    ctx: ProtocolContext,
    sessionId: string,
  ): Promise<EstablishedConnection> => {
    const now = Date.now();
    await ctx.sessions.upsertSession({
      id: sessionId,
      origin: `https://${id}.example`,
      status: "connected",
      createdAt: now,
      updatedAt: now,
    });
    const { a, b } = createInMemoryTransportPair();
    peerSides.push(b);
    return { sessionId, transport: a };
  };

  const protocol: ConnectionProtocol = {
    id,
    createResponder(ctx) {
      return {
        async accept(request: string): Promise<EstablishedConnection> {
          accepted.push(request);
          return establish(ctx, `${id}-session`);
        },
        ...(resumeRole
          ? {
              resume: async (session: ConnectionSession): Promise<EstablishedConnection> => {
                resumed.push(session.id);
                return establish(ctx, session.id);
              },
            }
          : {}),
      };
    },
  };
  return { protocol, accepted, resumed, peerSides };
}

function mount(
  protocols: ConnectionProtocol[],
  extra: Omit<NonNullable<ReactNativeConnectionsOptions["connections"]>, "protocols"> = {},
  provider: Record<string, any> = {},
): ReactNativeConnectionsExtension {
  return WithConnections(provider as any, {
    connections: { protocols, ...extra },
  }) as ReactNativeConnectionsExtension;
}

describe("React Native WithConnections", () => {
  it("routes accept through the registered protocol and returns the tracked session", async () => {
    const { protocol, accepted } = stubProtocol();
    const ext = mount([protocol]);

    const session = await ext.connection.accept("stub://request", "stub");

    expect(accepted).toEqual(["stub://request"]);
    expect(session).toMatchObject({ id: "stub-session", status: "connected" });
    expect(ext.connections).toHaveLength(1);
  });

  it("defaults to the single registered protocol when no id is passed", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    const session = await ext.connection.accept("stub://request");
    expect(session.id).toBe("stub-session");
  });

  it("requires a protocolId when multiple protocols are registered", async () => {
    const ext = mount([stubProtocol("one").protocol, stubProtocol("two").protocol]);

    await expect(ext.connection.accept("one://request")).rejects.toBeInstanceOf(
      UnknownProtocolError,
    );
  });

  it("throws a typed error for unknown protocol ids", async () => {
    const ext = mount([stubProtocol().protocol]);

    await expect(ext.connection.accept("x://request", "walletconnect")).rejects.toBeInstanceOf(
      UnknownProtocolError,
    );
  });

  it("disconnect closes the live transport and marks the session disconnected", async () => {
    const { protocol, peerSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.accept("stub://request");

    await ext.connection.disconnect(session.id);

    expect(peerSides[0].state).toBe("closed");
    expect(await ext.connection.store.getSession(session.id)).toMatchObject({
      status: "disconnected",
    });
  });

  it("resume renegotiates through the responder and tracks the new transport", async () => {
    const { protocol, resumed, peerSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.accept("stub://request");
    await ext.connection.disconnect(session.id);

    const refreshed = await ext.connection.resume(session.id);

    expect(resumed).toEqual([session.id]);
    expect(refreshed).toMatchObject({ id: session.id, status: "connected" });
    // The new transport is tracked: disconnect closes it.
    await ext.connection.disconnect(session.id);
    expect(peerSides[1].state).toBe("closed");
  });

  it("shares a single in-flight resume across concurrent calls", async () => {
    const { protocol, resumed } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.accept("stub://request");
    await ext.connection.disconnect(session.id);

    const [first, second] = await Promise.all([
      ext.connection.resume(session.id),
      ext.connection.resume(session.id),
    ]);

    expect(resumed).toEqual([session.id]);
    expect(first).toEqual(second);
  });

  it("rejects resume for unknown sessions", async () => {
    const { protocol } = stubProtocol();
    const ext = mount([protocol]);

    await expect(ext.connection.resume("ghost")).rejects.toThrow("no session ghost to resume");
  });

  it("rejects resume when the responder does not implement it", async () => {
    const { protocol } = stubProtocol("stub", { resumeRole: false });
    const ext = mount([protocol]);
    const session = await ext.connection.accept("stub://request");

    await expect(ext.connection.resume(session.id)).rejects.toThrow(
      "protocol stub does not implement resume",
    );
  });

  it("a stale transport closing after resume does not untrack the resumed transport", async () => {
    const { protocol, peerSides } = stubProtocol();
    const ext = mount([protocol]);
    const session = await ext.connection.accept("stub://request");

    await ext.connection.resume(session.id);

    // The peer side of the FIRST negotiation closes late.
    peerSides[0].close();

    // The resumed transport is still tracked: disconnect closes it.
    await ext.connection.disconnect(session.id);
    expect(peerSides[1].state).toBe("closed");
  });

  describe("domains", () => {
    /** A protocol whose responder answers `connect` from `ctx.domains`. */
    function domainsProtocol(): {
      protocol: ConnectionProtocol;
      exposures: Record<string, unknown[]>[];
    } {
      const exposures: Record<string, unknown[]>[] = [];
      const protocol: ConnectionProtocol = {
        id: "domains",
        createResponder(ctx) {
          return {
            async accept(request: string): Promise<EstablishedConnection> {
              // A real protocol answers the dapp's `connect` RPC from the
              // engine's registry; the stub records the exposed map.
              exposures.push((await ctx.domains?.expose()) ?? {});
              const now = Date.now();
              const sessionId = `${request}-session`;
              await ctx.sessions.upsertSession({
                id: sessionId,
                origin: "https://dapp.example",
                status: "connected",
                createdAt: now,
                updatedAt: now,
              });
              const { a } = createInMemoryTransportPair();
              return { sessionId, transport: a };
            },
          };
        },
      };
      return { protocol, exposures };
    }

    it("threads the provider-inferred domain registry into the ProtocolContext", async () => {
      const { protocol, exposures } = domainsProtocol();
      const provider: Record<string, any> = {};
      const ext = mount([protocol], {}, provider);

      // The store extension mounts AFTER the connections engine;
      // discovery is lazy, so the domain is still announced.
      provider.passkey = {
        store: {},
        remote: { expose: () => [{ credentialId: "cred-1" }] },
      };

      await ext.connection.accept("req");

      expect(exposures).toEqual([{ passkeys: [{ credentialId: "cred-1" }] }]);
    });

    it("prefers an explicit domains option over provider-surface inference", async () => {
      const { protocol, exposures } = domainsProtocol();
      const provider: Record<string, any> = {
        passkey: { store: {}, remote: { expose: () => [{ credentialId: "surface" }] } },
      };
      const ext = mount(
        [protocol],
        { domains: [defineDomain({ id: "accounts", expose: () => [{ address: "A" }] })] },
        provider,
      );

      await ext.connection.accept("req");

      expect(exposures).toEqual([{ accounts: [{ address: "A" }] }]);
    });

    it("announces an empty map over an empty provider surface", async () => {
      const { protocol, exposures } = domainsProtocol();
      const ext = mount([protocol]);

      await ext.connection.accept("req");

      expect(exposures).toEqual([{}]);
    });

    it("revokes the session's domain mirrors on disconnect", async () => {
      const { protocol } = stubProtocol();
      const revoke = vi.fn();
      const provider: Record<string, any> = {
        identity: { store: {}, remote: { revoke } },
      };
      const ext = mount([protocol], {}, provider);
      const session = await ext.connection.accept("stub://request");

      await ext.connection.disconnect(session.id);

      expect(revoke).toHaveBeenCalledWith(session.id);
    });
  });
});
