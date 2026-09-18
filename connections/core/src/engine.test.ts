import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONNECTIONS_KEY,
  createConnectionsStore,
  memoryConnectionDriver,
} from "./engine.ts";
import type { ConnectionMessage, ConnectionSession } from "./types.ts";

function makeSession(overrides: Partial<ConnectionSession> = {}): ConnectionSession {
  return {
    id: "session-1",
    origin: "https://dapp.example",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ConnectionMessage> = {}): ConnectionMessage {
  return {
    id: "message-1",
    sessionId: "session-1",
    direction: "outgoing",
    text: "hello",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("Connections Store Engine", () => {
  it("upserts, reads, updates, and removes sessions", async () => {
    const { api } = createConnectionsStore();

    await api.upsertSession(makeSession());
    expect(await api.getSession("session-1")).toMatchObject({ status: "pending" });

    await api.updateSessionStatus("session-1", "connected");
    expect(await api.getSession("session-1")).toMatchObject({ status: "connected" });

    await api.upsertSession(makeSession({ id: "session-2" }));
    expect(await api.getSessions()).toHaveLength(2);

    await api.removeSession("session-1");
    expect(await api.getSession("session-1")).toBeUndefined();

    await api.clearSessions();
    expect(await api.getSessions()).toHaveLength(0);
  });

  it("replaces sessions by id on upsert", async () => {
    const { api } = createConnectionsStore();

    await api.upsertSession(makeSession());
    await api.upsertSession(makeSession({ status: "connected" }));

    const sessions = await api.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("connected");
  });

  it("records the error detail on failed status updates", async () => {
    const { api } = createConnectionsStore();

    await api.upsertSession(makeSession());
    const updated = await api.updateSessionStatus("session-1", "failed", "peer vanished");

    expect(updated).toMatchObject({ status: "failed", error: "peer vanished" });
  });

  it("persists the sessions and messages slices through the driver", async () => {
    const driver = memoryConnectionDriver();
    const { api, ready } = createConnectionsStore({ driver });
    await ready;

    await api.upsertSession(makeSession({ status: "connected" }));
    await api.upsertMessage(makeMessage({ status: "delivered" }));

    const raw = await driver.get(DEFAULT_CONNECTIONS_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string)).toMatchObject({
      sessions: [{ id: "session-1", status: "connected" }],
      messages: [{ id: "message-1", status: "delivered" }],
    });
  });

  it("hydrates persisted sessions coerced to disconnected", async () => {
    const driver = memoryConnectionDriver({
      [DEFAULT_CONNECTIONS_KEY]: JSON.stringify({
        sessions: [makeSession({ status: "connected" })],
      }),
    });
    const { api, ready } = createConnectionsStore({ driver });
    await ready;

    expect(await api.getSession("session-1")).toMatchObject({ status: "disconnected" });
  });

  it("hydrates legacy bare-array snapshots as the sessions slice", async () => {
    const driver = memoryConnectionDriver({
      [DEFAULT_CONNECTIONS_KEY]: JSON.stringify([makeSession({ status: "connected" })]),
    });
    const { api, ready } = createConnectionsStore({ driver });
    await ready;

    expect(await api.getSession("session-1")).toMatchObject({ status: "disconnected" });
    expect(await api.getMessages()).toHaveLength(0);
  });

  it("hydrates persisted messages, coercing in-flight pending ones to failed", async () => {
    const driver = memoryConnectionDriver({
      [DEFAULT_CONNECTIONS_KEY]: JSON.stringify({
        sessions: [makeSession()],
        messages: [
          makeMessage({ id: "message-1", status: "pending" }),
          makeMessage({ id: "message-2", status: "delivered" }),
        ],
      }),
    });
    const { api, ready } = createConnectionsStore({ driver });
    await ready;

    expect(await api.getMessage("message-1")).toMatchObject({
      status: "failed",
      error: "interrupted by restart",
    });
    expect(await api.getMessage("message-2")).toMatchObject({ status: "delivered" });
  });

  it("keeps live records over hydrated ones on id collisions", async () => {
    const driver = memoryConnectionDriver({
      [DEFAULT_CONNECTIONS_KEY]: JSON.stringify([makeSession({ status: "connected" })]),
    });
    const { api, ready } = createConnectionsStore({ driver });
    await api.upsertSession(makeSession({ status: "connecting" }));
    await ready;

    const sessions = await api.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("connecting");
  });

  it("drops a corrupt persisted snapshot without failing hydration", async () => {
    const driver = memoryConnectionDriver({ [DEFAULT_CONNECTIONS_KEY]: "not json" });
    const { api, ready } = createConnectionsStore({ driver });
    await ready;

    expect(await api.getSessions()).toHaveLength(0);
  });

  it("respects the storageKey override", async () => {
    const driver = memoryConnectionDriver();
    const { api, ready } = createConnectionsStore({ driver, storageKey: "custom-key" });
    await ready;

    await api.upsertSession(makeSession());

    expect(await driver.get("custom-key")).toBeDefined();
    expect(await driver.get(DEFAULT_CONNECTIONS_KEY)).toBeUndefined();
  });

  it("upserts, reads, updates, and clears messages per session", async () => {
    const { api } = createConnectionsStore();

    await api.upsertMessage(makeMessage());
    await api.upsertMessage(makeMessage({ id: "message-2", sessionId: "session-2" }));
    expect(await api.getMessage("message-1")).toMatchObject({ status: "pending" });

    await api.updateMessageStatus("message-1", "failed", "peer vanished");
    expect(await api.getMessage("message-1")).toMatchObject({
      status: "failed",
      error: "peer vanished",
    });

    expect(await api.getMessages()).toHaveLength(2);
    expect(await api.getMessages("session-2")).toHaveLength(1);

    await api.clearMessages("session-2");
    expect(await api.getMessages()).toHaveLength(1);

    await api.clearMessages();
    expect(await api.getMessages()).toHaveLength(0);
  });

  it("keeps messages oldest-first and replaces by id on upsert", async () => {
    const { api } = createConnectionsStore();

    await api.upsertMessage(makeMessage({ id: "message-1" }));
    await api.upsertMessage(makeMessage({ id: "message-2" }));
    await api.upsertMessage(makeMessage({ id: "message-1", text: "replaced" }));

    const all = await api.getMessages();
    expect(all.map((m) => m.id)).toEqual(["message-1", "message-2"]);
    expect(all[0].text).toBe("replaced");
  });

  it("exposes the hook collection and runs before/after hooks", async () => {
    const { api } = createConnectionsStore();
    const order: string[] = [];
    api.hooks.before("upsert", () => {
      order.push("before");
    });
    api.hooks.after("upsert", () => {
      order.push("after");
    });

    await api.upsertSession(makeSession());

    expect(order).toEqual(["before", "after"]);
  });
});
