import { Store } from "@tanstack/store";
import { bench, describe } from "vitest";
import { addLog, getLog, removeLog } from "./store.ts";
import type { LogMessage, LogStoreState } from "./types.ts";

describe("Log Store Benchmarks", () => {
  const store = new Store<LogStoreState>({
    logs: [],
  });
  const baseLog: LogMessage = {
    id: "test-log",
    timestamp: new Date(),
    level: "info",
    message: "benchmark",
  };

  bench("addLog", () => {
    addLog({ store, log: { ...baseLog, id: Math.random().toString(36) } });
  });

  bench("getLog", () => {
    getLog({ store, logId: baseLog.id });
  });

  bench("removeLog", () => {
    removeLog({ store, logId: baseLog.id });
  });
});
