import { describe, expect, it } from "vitest";

import { ConnectionRpcError } from "./errors.ts";
import { createConnectionRpc } from "./rpc.ts";
import { createInMemoryTransportPair } from "./transport.ts";

describe("Connection RPC", () => {
  it("round-trips a request/response between both peers", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const responder = createConnectionRpc(b);

    responder.onRequest(async (method, params) => {
      expect(method).toBe("connect");
      expect(params).toEqual({ metadata: { name: "Dapp" } });
      return { domains: { accounts: [{ address: "ADDR" }] } };
    });

    const result = await requester.request("connect", { metadata: { name: "Dapp" } });
    expect(result).toEqual({ domains: { accounts: [{ address: "ADDR" }] } });
  });

  it("propagates handler ConnectionRpcError codes verbatim", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const responder = createConnectionRpc(b);

    responder.onRequest(async () => {
      throw new ConnectionRpcError("rejected", "user denied the connection");
    });

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      name: "ConnectionRpcError",
      code: "rejected",
      message: "user denied the connection",
    });
  });

  it("wraps non-rpc handler failures as handler_error", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const responder = createConnectionRpc(b);

    responder.onRequest(async () => {
      throw new Error("boom");
    });

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      code: "handler_error",
      message: "boom",
    });
  });

  it("answers method_not_found when no handler is registered", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    createConnectionRpc(b);

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      code: "method_not_found",
    });
  });

  it("rejects with timeout when no response arrives in time", async () => {
    const { a } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a, { timeoutMs: 10 });

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("rejects with aborted when the signal fires", async () => {
    const { a } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const controller = new AbortController();

    const pending = requester.request("connect", {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects pending requests with transport_closed when the transport closes", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    createConnectionRpc(b);

    const pending = requester.request("connect", {});
    a.close();

    await expect(pending).rejects.toMatchObject({ code: "transport_closed" });
  });

  it("rejects immediately when requesting over a closed transport", async () => {
    const { a } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    a.close();

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      code: "transport_closed",
    });
  });

  it("ignores malformed frames without wedging the channel", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const responder = createConnectionRpc(b);
    responder.onRequest(async () => "ok");

    b.send("not json");
    b.send(JSON.stringify({ v: 1, kind: "response", id: "unknown", result: 42 }));

    await expect(requester.request("connect", {})).resolves.toBe("ok");
  });

  it("unregisters a request handler via the returned function", async () => {
    const { a, b } = createInMemoryTransportPair();
    const requester = createConnectionRpc(a);
    const responder = createConnectionRpc(b);

    const unregister = responder.onRequest(async () => "ok");
    unregister();

    await expect(requester.request("connect", {})).rejects.toMatchObject({
      code: "method_not_found",
    });
  });
});
