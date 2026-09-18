import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { describe, expect, it, vi } from "vitest";
import { WithLogs } from "./extension.ts";
import { addLog, clearLogs, getLog, removeLog } from "./store.ts";
import type { LogMessage, LogStoreState } from "./types.ts";

describe("Log Store Extension", () => {
  it("should align with README usage", async () => {
    const MyProvider = Provider.withExtensions([WithLogs]);
    const provider = new MyProvider({ id: "test", name: "Test" }) as any;

    // Access log store methods
    await provider.log.info("Hello");
    expect(provider.logs).toHaveLength(1);
    expect(provider.logs[0].message).toEqual("Hello");

    await provider.log.clear();
    expect(provider.logs).toHaveLength(0);
  });

  it("records metadata and context on every level and mirrors the matching console method", () => {
    const store = new Store<LogStoreState>({ logs: [] });
    const MyProvider = Provider.withExtensions([WithLogs]);
    const provider = new MyProvider({ id: "test", name: "Test" }, { log: { store } });

    const spies = {
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      trace: vi.spyOn(console, "trace").mockImplementation(() => {}),
    };

    for (const level of ["info", "warn", "error", "debug", "trace"] as const) {
      provider.log[level](`${level} message`, { level }, "test-suite");
      expect(spies[level]).toHaveBeenCalledWith(`[test-suite] ${level} message`, { level });
      const entry = store.state.logs[0];
      expect(entry.level).toBe(level);
      expect(entry.metadata).toEqual({ level });
      expect(entry.context).toBe("test-suite");
    }
    expect(provider.logs).toHaveLength(5);

    vi.restoreAllMocks();
  });

  it("defaults metadata to an empty object", () => {
    const MyProvider = Provider.withExtensions([WithLogs]);
    const provider = new MyProvider({ id: "test", name: "Test" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    provider.log.info("bare");
    expect(provider.logs[0].metadata).toEqual({});
    expect(provider.logs[0].context).toBe("");
    vi.restoreAllMocks();
  });

  describe("store functions", () => {
    it("should add a log", () => {
      const store = new Store<LogStoreState>({
        logs: [],
      });
      const log: LogMessage = {
        id: "1",
        timestamp: new Date(),
        level: "info",
        message: "test",
      };
      addLog({ store, log });
      expect(store.state.logs).toContain(log);
    });

    it("should remove a log", () => {
      const log: LogMessage = {
        id: "1",
        timestamp: new Date(),
        level: "info",
        message: "test",
      };
      const store = new Store<LogStoreState>({
        logs: [log],
      });
      removeLog({ store, logId: "1" });
      expect(store.state.logs).not.toContain(log);
    });

    it("should get a log", () => {
      const log: LogMessage = {
        id: "1",
        timestamp: new Date(),
        level: "info",
        message: "test",
      };
      const store = new Store<LogStoreState>({
        logs: [log],
      });
      const found = getLog({ store, logId: "1" });
      expect(found).toEqual(log);
    });

    it("should return undefined for non-existent log", () => {
      const store = new Store<LogStoreState>({
        logs: [],
      });
      const found = getLog({ store, logId: "non-existent" });
      expect(found).toBeUndefined();
    });
    it("should clear logs", () => {
      const log: LogMessage = {
        id: "1",
        timestamp: new Date(),
        level: "info",
        message: "test",
      };
      const store = new Store<LogStoreState>({
        logs: [log],
      });
      clearLogs({ store });
      expect(store.state.logs).toHaveLength(0);
    });
  });
});
