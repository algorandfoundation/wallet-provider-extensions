import type { Store } from "@tanstack/store";
import type { LogMessage, LogStoreState } from "./types.ts";

/**
 * Adds a new log message to the store.
 *
 * @param params - The log parameters.
 * @param params.store - The TanStack store instance for {@link LogStoreState}.
 * @param params.log - The {@link LogMessage} to add.
 * @returns The added {@link LogMessage}.
 */
export function addLog({
  store,
  log,
}: {
  store: Store<LogStoreState>;
  log: LogMessage;
}): LogMessage {
  store.setState((state) => {
    return {
      logs: [log, ...state.logs],
    };
  });
  return log;
}

/**
 * Removes a log message from the store by its ID.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link LogStoreState}.
 * @param params.logId - The unique identifier of the log message to remove.
 */
export function removeLog({ store, logId }: { store: Store<LogStoreState>; logId: string }): void {
  store.setState((state) => {
    return {
      logs: state.logs.filter((log) => log.id !== logId),
    };
  });
}

/**
 * Retrieves a log message from the store by its ID.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link LogStoreState}.
 * @param params.logId - The unique identifier of the log message to retrieve.
 * @returns The {@link LogMessage} if found, otherwise undefined.
 */
export function getLog({
  store,
  logId,
}: {
  store: Store<LogStoreState>;
  logId: string;
}): LogMessage | undefined {
  return store.state.logs.find((log) => log.id === logId);
}

/**
 * Clears all log messages from the store.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link LogStoreState}.
 */
export function clearLogs({ store }: { store: Store<LogStoreState> }): void {
  store.setState(() => {
    return {
      logs: [],
    };
  });
}
