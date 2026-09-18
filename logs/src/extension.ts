// Core Dependencies
import { type Extension, generateId } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";

// Store Mutations
import { addLog, clearLogs } from "./store.ts";

// Interface Types
import type { LogLevel, LogStoreExtension, LogStoreOptions, LogStoreState } from "./types.ts";

/**
 * Provider extension that records wallet activity in a reactive log store.
 *
 * Works with zero configuration: a fresh in-memory `Store<LogStoreState>` is
 * created when `options.log.store` is omitted. It contributes the `log`
 * namespace (`info`, `warn`, `error`, `debug`, `trace`, `clear`) and the
 * reactive `logs` getter. Every entry is also mirrored to the matching
 * `console.*` method for convenience during development.
 *
 * Other extensions treat the log as an **optional** dependency: they probe
 * `provider.log?.info(...)` and stay silent when this extension is absent.
 *
 * @param _provider - The provider being extended (unused).
 * @param options - {@link LogStoreOptions}; `log.store` shares a store you own.
 * @returns The {@link LogStoreExtension} surface.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithLogs, WithKeyStore]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" });
 *
 * provider.log.info("Initialized wallet", { scope: "init" });
 * console.log(provider.logs[0].metadata); // { scope: "init" }
 * ```
 */
export const WithLogs: Extension<LogStoreExtension> = (
  _provider,
  options: LogStoreOptions = {},
) => {
  const logsStore = options.log?.store ?? new Store<LogStoreState>({ logs: [] });

  const emit =
    (level: LogLevel) =>
    (message: string, metadata: Record<string, unknown> = {}, context?: string): void => {
      addLog({
        store: logsStore,
        log: {
          id: generateId(),
          level,
          context: context ?? "",
          timestamp: new Date(),
          message,
          metadata,
        },
      });
      // Mirror to the matching console method (each LogLevel is a console method name).
      console[level]((context ? `[${context}] ` : "") + message, metadata);
    };

  return {
    get logs() {
      return logsStore.state.logs;
    },
    log: {
      info: emit("info"),
      warn: emit("warn"),
      error: emit("error"),
      debug: emit("debug"),
      trace: emit("trace"),
      clear() {
        clearLogs({ store: logsStore });
      },
    },
  } as LogStoreExtension;
};
