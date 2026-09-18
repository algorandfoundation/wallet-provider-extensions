import { describe, expect, it, vi } from "vitest";

import { createConnectionsStore } from "./engine.ts";
import {
  createProtocolRegistry,
  UnknownProtocolError,
  type ConnectionProtocol,
  type ConnectionRequester,
  type ConnectionResponder,
  type ProtocolContext,
} from "./protocol.ts";
import { createInMemoryTransportPair } from "./transport.ts";
import type { ConnectionTransport } from "./types.ts";

function makeContext(): ProtocolContext {
  return { sessions: createConnectionsStore().api };
}

function makeTransport(): ConnectionTransport {
  return createInMemoryTransportPair().a;
}

function makeProtocol(id: string): {
  protocol: ConnectionProtocol;
  requester: ConnectionRequester;
  responder: ConnectionResponder;
  createRequester: ReturnType<typeof vi.fn>;
  createResponder: ReturnType<typeof vi.fn>;
} {
  const requester: ConnectionRequester = {
    createRequest: async () => ({
      id: "req-1",
      uri: `${id}://request`,
      qrData: `${id}://request`,
      establish: async () => makeTransport(),
    }),
  };
  const responder: ConnectionResponder = {
    accept: async () => ({ sessionId: "req-1", transport: makeTransport() }),
  };
  const createRequester = vi.fn(() => requester);
  const createResponder = vi.fn(() => responder);
  return {
    protocol: { id, createRequester, createResponder },
    requester,
    responder,
    createRequester,
    createResponder,
  };
}

describe("Protocol Registry", () => {
  it("resolves registered protocols by id", () => {
    const { protocol } = makeProtocol("liquid-auth");
    const registry = createProtocolRegistry([protocol]);

    expect(registry.has("liquid-auth")).toBe(true);
    expect(registry.get("liquid-auth")).toBe(protocol);
    expect(registry.ids()).toEqual(["liquid-auth"]);
  });

  it("throws a typed error for unknown protocol ids", () => {
    const registry = createProtocolRegistry();

    expect(registry.has("walletconnect")).toBe(false);
    expect(() => registry.get("walletconnect")).toThrowError(UnknownProtocolError);
    try {
      registry.get("walletconnect");
      expect.unreachable("get must throw");
    } catch (e) {
      const error = e as UnknownProtocolError;
      expect(error.code).toBe("unknown_protocol");
      expect(error.protocolId).toBe("walletconnect");
    }
  });

  it("invokes the requester factory with the protocol context", () => {
    const { protocol, requester, createRequester } = makeProtocol("liquid-auth");
    const registry = createProtocolRegistry([protocol]);
    const ctx = makeContext();

    expect(registry.createRequester("liquid-auth", ctx)).toBe(requester);
    expect(createRequester).toHaveBeenCalledExactlyOnceWith(ctx);
  });

  it("invokes the responder factory with the protocol context", () => {
    const { protocol, responder, createResponder } = makeProtocol("liquid-auth");
    const registry = createProtocolRegistry([protocol]);
    const ctx = makeContext();

    expect(registry.createResponder("liquid-auth", ctx)).toBe(responder);
    expect(createResponder).toHaveBeenCalledExactlyOnceWith(ctx);
  });

  it("throws when a protocol does not implement the requested role", () => {
    const requesterOnly: ConnectionProtocol = {
      id: "requester-only",
      createRequester: () => makeProtocol("requester-only").requester,
    };
    const responderOnly: ConnectionProtocol = {
      id: "responder-only",
      createResponder: () => makeProtocol("responder-only").responder,
    };
    const registry = createProtocolRegistry([requesterOnly, responderOnly]);
    const ctx = makeContext();

    expect(() => registry.createResponder("requester-only", ctx)).toThrowError(
      UnknownProtocolError,
    );
    expect(() => registry.createRequester("responder-only", ctx)).toThrowError(
      UnknownProtocolError,
    );
  });

  it("lets later registrations override earlier ones by id", () => {
    const first = makeProtocol("liquid-auth").protocol;
    const second = makeProtocol("liquid-auth").protocol;
    const registry = createProtocolRegistry([first, second]);

    expect(registry.get("liquid-auth")).toBe(second);
    expect(registry.ids()).toEqual(["liquid-auth"]);
  });

  it("is exposed by the connections store engine", () => {
    const { protocol } = makeProtocol("liquid-auth");
    const engine = createConnectionsStore({ protocols: [protocol] });

    expect(engine.protocols.has("liquid-auth")).toBe(true);
    expect(engine.protocols.get("liquid-auth")).toBe(protocol);
  });

  it("defaults to an empty registry when the engine registers no protocols", () => {
    const engine = createConnectionsStore();

    expect(engine.protocols.ids()).toEqual([]);
    expect(() => engine.protocols.get("liquid-auth")).toThrowError(UnknownProtocolError);
  });
});
