import { describe, expect, it, vi } from "vitest";

import { createConnectionsStore } from "@algorandfoundation/connections-core";
import type { ConnectionSession, ProtocolContext } from "@algorandfoundation/connections-core";

import { createMockSignaling, type MockSignalingHub } from "./mock.ts";
import { createLiquidAuthRequester } from "./requester.ts";

const URL = "https://liquid.example.com";

function makeContext(): ProtocolContext {
  return { sessions: createConnectionsStore().api };
}

function makeRequester(
  hub: MockSignalingHub,
  ctx: ProtocolContext,
): ReturnType<typeof createLiquidAuthRequester> {
  return createLiquidAuthRequester(
    {
      url: URL,
      createSignalClient: hub.createSignalClient,
      generateRequestId: () => "req-1",
    },
    ctx,
  );
}

/** Joins the room from the "wallet side" of the mock hub. */
function joinAsWallet(hub: MockSignalingHub, requestId: string): void {
  void hub.createSignalClient(URL).peer(requestId, "answer");
}

describe("Liquid Auth requester", () => {
  it("createRequest exposes the liquid:// URI and establishes when the wallet answers", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const requester = makeRequester(hub, ctx);

    const request = await requester.createRequest();
    expect(request.id).toBe("req-1");
    expect(request.uri).toBe("liquid://liquid.example.com/?requestId=req-1");
    expect(request.qrData).toBe(request.uri);
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "pending" });

    const pending = request.establish();
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });

    joinAsWallet(hub, "req-1");
    const transport = await pending;
    expect(transport.state).toBe("open");
  });

  it("shares a single peer negotiation across establish() calls", async () => {
    const hub = createMockSignaling();
    const requester = makeRequester(hub, makeContext());

    const request = await requester.createRequest();
    const first = request.establish();
    const second = request.establish();

    joinAsWallet(hub, "req-1");
    expect(await first).toBe(await second);
  });

  it("tolerates the wallet joining the room before establish() is called", async () => {
    const hub = createMockSignaling();
    // Wallet is already waiting in the room before the dapp establishes.
    joinAsWallet(hub, "req-1");
    const requester = makeRequester(hub, makeContext());

    const request = await requester.createRequest();
    const transport = await request.establish();
    expect(transport.state).toBe("open");
  });

  it("transitions the session to disconnected when the channel closes", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const requester = makeRequester(hub, ctx);

    const request = await requester.createRequest();
    const pending = request.establish();
    joinAsWallet(hub, "req-1");
    const transport = await pending;

    transport.close();
    await vi.waitFor(async () => {
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "disconnected" });
    });
  });

  it("rejects with aborted and closes the client when the signal fires", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const requester = makeRequester(hub, ctx);
    const controller = new AbortController();

    const request = await requester.createRequest();
    const pending = request.establish({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(hub.clients[0].closed).toBe(true);
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "disconnected" });
  });

  it("rejects immediately when establish() starts with an already-aborted signal", async () => {
    const hub = createMockSignaling();
    const requester = makeRequester(hub, makeContext());
    const controller = new AbortController();
    controller.abort();

    const request = await requester.createRequest();
    await expect(request.establish({ signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(hub.clients[0].closed).toBe(true);
  });

  it("marks the session failed when signaling fails", async () => {
    const hub = createMockSignaling();
    const ctx = makeContext();
    const requester = makeRequester(hub, ctx);

    const request = await requester.createRequest();
    const pending = request.establish();
    // Wait for the requester to join the room before failing it.
    await vi.waitFor(async () => {
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });
    });
    hub.failRoom("req-1");

    await expect(pending).rejects.toThrowError("signaling failed");
    expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "failed" });
  });

  it("throws a typed error when no url is configured", () => {
    expect(() => createLiquidAuthRequester({ url: "" }, makeContext())).toThrowError(
      /signaling `url` is required/,
    );
  });

  describe("resume", () => {
    /** A previously-paired session, as the engine's store would carry it. */
    function makeSession(overrides: Record<string, unknown> = {}): ConnectionSession {
      const createdAt = Date.now() - 60_000;
      return {
        id: "req-1",
        origin: URL,
        status: "disconnected",
        createdAt,
        updatedAt: createdAt,
        ...overrides,
      } as ConnectionSession;
    }

    it("parks on the rendezvous and resolves when the wallet re-offers", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const requester = makeRequester(hub, ctx);
      const session = makeSession();

      const pending = requester.resume!(session);
      await vi.waitFor(async () => {
        expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });
      });

      // The wallet rejoins the room and re-sends its offer.
      joinAsWallet(hub, "req-1");
      const transport = await pending;
      expect(transport.state).toBe("open");
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({
        status: "connected",
        createdAt: session.createdAt,
      });
    });

    it("uses a fresh signal client per resume (the negotiation is single-shot)", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const requester = makeRequester(hub, ctx);

      const request = await requester.createRequest();
      const established = request.establish();
      joinAsWallet(hub, "req-1");
      (await established).close();

      const resumed = requester.resume!(makeSession());
      joinAsWallet(hub, "req-1");
      await resumed;
      // createRequest's client + 2 wallet joins + resume's fresh client.
      expect(hub.clients).toHaveLength(4);
    });

    it("rejects with aborted, closes the client, and disconnects the session on abort", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const requester = makeRequester(hub, ctx);
      const controller = new AbortController();

      const pending = requester.resume!(makeSession(), { signal: controller.signal });
      await vi.waitFor(async () => {
        expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });
      });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ code: "aborted" });
      expect(hub.clients[0].closed).toBe(true);
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "disconnected" });
    });

    it("marks the session failed when the resume signaling fails", async () => {
      const hub = createMockSignaling();
      const ctx = makeContext();
      const requester = makeRequester(hub, ctx);

      const pending = requester.resume!(makeSession());
      await vi.waitFor(async () => {
        expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "connecting" });
      });
      hub.failRoom("req-1");

      await expect(pending).rejects.toThrowError("signaling failed");
      expect(hub.clients[0].closed).toBe(true);
      expect(await ctx.sessions.getSession("req-1")).toMatchObject({ status: "failed" });
    });

    it("rejects sessions without an id with a typed error", async () => {
      const requester = makeRequester(createMockSignaling(), makeContext());

      await expect(requester.resume!(makeSession({ id: "" }))).rejects.toMatchObject({
        code: "invalid_session",
      });
    });
  });
});
