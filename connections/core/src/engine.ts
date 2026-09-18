/**
 * The platform-neutral connections store **engine**.
 *
 * Mirrors the credentials/keystore architecture: this package exports no
 * mounted extension of its own. Transport packages (the liquid-auth
 * WebRTC `connections-web` / `react-native-connections`, landing next)
 * build this engine with a platform-appropriate persistence driver and
 * wire live {@link import("./types.ts").ConnectionTransport}s to the
 * sessions it tracks.
 *
 * Persistence is a deliberately tiny key/value seam
 * ({@link ConnectionKeyValueStore}), shaped after the
 * `CredentialKeyValueStore` of `@algorandfoundation/credentials-core`.
 * The `sessions` and `messages` slices are persisted; since transports
 * never survive a restart, hydrated sessions are coerced to the
 * `disconnected` status (and in-flight `pending` messages to `failed`).
 */

import type { LogStoreApi } from "@algorandfoundation/logs";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import type { HookCollection } from "before-after-hook";

import { createProtocolRegistry } from "./protocol.ts";
import type { ConnectionProtocol, ProtocolRegistry } from "./protocol.ts";
import {
  clearMessages,
  clearSessions,
  getMessage,
  getMessages,
  getSession,
  getSessions,
  removeSession,
  updateMessageStatus,
  updateSessionStatus,
  upsertMessage,
  upsertSession,
} from "./store.ts";
import type {
  ConnectionMessage,
  ConnectionMessageStatus,
  ConnectionSession,
  ConnectionSessionStatus,
  ConnectionsState,
  ConnectionsStoreApi,
} from "./types.ts";

/**
 * A string key/value persistence seam for the connections store.
 *
 * Same shape as the `CredentialKeyValueStore` of
 * `@algorandfoundation/credentials-core` (itself shaped after the
 * `KeyValueStore` contract of `@algorandfoundation/provider-migrations`):
 * MMKV, `localStorage`, AsyncStorage, IndexedDB or a file wrapper all
 * adapt in two lines.
 *
 * @example
 * ```typescript
 * const mmkvConnectionDriver: ConnectionKeyValueStore = {
 *   get: (key) => mmkv.getString(key) ?? null,
 *   set: (key, value) => mmkv.set(key, value),
 * };
 * ```
 */
export interface ConnectionKeyValueStore {
  /** Reads the serialized snapshot; absent keys read as `null`/`undefined`. */
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  /** Persists the serialized snapshot. */
  set(key: string, value: string): void | Promise<void>;
}

/**
 * Default storage key under which the sessions snapshot is serialized.
 *
 * @example
 * ```typescript
 * const raw = await driver.get(DEFAULT_CONNECTIONS_KEY);
 * ```
 */
export const DEFAULT_CONNECTIONS_KEY: string = "@algorandfoundation/connections";

/**
 * An in-memory {@link ConnectionKeyValueStore}.
 *
 * Nothing survives a restart. Used as the fallback driver by the
 * platform engines (and handy in tests); applications should inject a
 * durable driver via `options.connections.driver`.
 *
 * @param initial - Key/value pairs to seed the driver with.
 * @returns An in-memory {@link ConnectionKeyValueStore}.
 *
 * @example
 * ```typescript
 * const { api, ready } = createConnectionsStore({ driver: memoryConnectionDriver() });
 * ```
 */
export function memoryConnectionDriver(
  initial: Record<string, string> = {},
): ConnectionKeyValueStore {
  const state: Record<string, string> = { ...initial };
  return {
    get(key: string): string | undefined {
      return state[key];
    },
    set(key: string, value: string): void {
      state[key] = value;
    },
  };
}

/**
 * Options accepted by {@link createConnectionsStore}.
 *
 * @example
 * ```typescript
 * const options: CreateConnectionsStoreOptions = {
 *   driver: memoryConnectionDriver(),
 *   protocols: [liquidAuth({ url })],
 * };
 * ```
 */
export interface CreateConnectionsStoreOptions {
  /** Reactive store backing the engine; created when not provided. */
  store?: Store<ConnectionsState>;
  /**
   * Hook collection bound at creation. Every store operation is
   * interceptable via `before`/`after` hooks and is exposed as
   * `api.hooks`. This is how transport packages thread application
   * hooks into the engine.
   */
  hooks?: HookCollection<any>;
  /**
   * Persistence driver for the `sessions` slice. When omitted the store
   * is purely in-memory (no hydration, no persistence).
   */
  driver?: ConnectionKeyValueStore;
  /** Storage key override; defaults to {@link DEFAULT_CONNECTIONS_KEY}. */
  storageKey?: string;
  /**
   * Connection protocols the application opts into (e.g.
   * `[liquidAuth(...)]`). Exposed as the engine's `protocols` registry,
   * which platform `WithConnections` implementations route
   * `connect(protocolId)` / `accept(protocolId, ...)` calls through.
   */
  protocols?: ConnectionProtocol[];
  /** Optional logger (typically `provider.log`). */
  log?: LogStoreApi;
}

/**
 * The connections store engine: the hooks-wrapped
 * {@link ConnectionsStoreApi}, the reactive store backing it, and a
 * `ready` promise that resolves once hydration from the persistence
 * driver has completed.
 *
 * @example
 * ```typescript
 * const engine: ConnectionsStore = createConnectionsStore();
 * await engine.ready;
 * ```
 */
export interface ConnectionsStore {
  /** The session CRUD API surface. */
  api: ConnectionsStoreApi;
  /** The reactive tanstack store backing the engine. */
  store: Store<ConnectionsState>;
  /** Registry of the protocols registered via `options.protocols`. */
  protocols: ProtocolRegistry;
  /** Resolves once the driver snapshot has been hydrated (immediately when no driver). */
  ready: Promise<void>;
}

/**
 * Creates the platform-neutral connections store engine.
 *
 * Owns the reactive state, wraps every operation in the hook collection,
 * and hydrates from / persists to the {@link ConnectionKeyValueStore}
 * driver. Hydrated sessions are coerced to the `disconnected` status:
 * live transports never survive a restart, so a session persisted as
 * `connected` would otherwise lie about its channel.
 *
 * @param options - {@link CreateConnectionsStoreOptions}.
 * @returns The {@link ConnectionsStore} engine.
 *
 * @example
 * ```typescript
 * const { api, store, ready } = createConnectionsStore({
 *   driver: keyValueDriver,
 * });
 * await ready;
 * await api.upsertSession(session);
 * ```
 */
export function createConnectionsStore(
  options: CreateConnectionsStoreOptions = {},
): ConnectionsStore {
  const log = options.log;
  const store =
    options.store ??
    new Store<ConnectionsState>({
      sessions: [],
      messages: [],
    });
  const hooks = options.hooks ?? new Hook.Collection<any>();
  const protocols = createProtocolRegistry(options.protocols);
  const driver = options.driver;
  const storageKey = options.storageKey ?? DEFAULT_CONNECTIONS_KEY;

  const api: ConnectionsStoreApi = {
    upsertSession: async (session: ConnectionSession) => {
      log?.info(
        `upsertSession called: id=${session.id}, status=${session.status}`,
        {},
        "ConnectionsStore",
      );
      return hooks("upsert", upsertSession, { store, session });
    },
    updateSessionStatus: async (id: string, status: ConnectionSessionStatus, error?: string) => {
      log?.info(`updateSessionStatus called: id=${id}, status=${status}`, {}, "ConnectionsStore");
      return hooks("updateStatus", updateSessionStatus, { store, id, status, error });
    },
    removeSession: async (id: string) => {
      log?.info(`removeSession called: id=${id}`, {}, "ConnectionsStore");
      return hooks("remove", removeSession, { store, id });
    },
    clearSessions: async () => {
      log?.info("clearSessions called", {}, "ConnectionsStore");
      return hooks("clear", clearSessions, { store });
    },
    getSession: async (id: string) => {
      log?.debug(`getSession called: id=${id}`, {}, "ConnectionsStore");
      return hooks("get", getSession, { store, id });
    },
    getSessions: async () => {
      log?.debug("getSessions called", {}, "ConnectionsStore");
      return hooks("list", getSessions, { store });
    },
    upsertMessage: async (message: ConnectionMessage) => {
      log?.info(
        `upsertMessage called: id=${message.id}, sessionId=${message.sessionId}, status=${message.status}`,
        {},
        "ConnectionsStore",
      );
      return hooks("upsertMessage", upsertMessage, { store, message });
    },
    updateMessageStatus: async (id: string, status: ConnectionMessageStatus, error?: string) => {
      log?.info(`updateMessageStatus called: id=${id}, status=${status}`, {}, "ConnectionsStore");
      return hooks("updateMessageStatus", updateMessageStatus, { store, id, status, error });
    },
    getMessage: async (id: string) => {
      log?.debug(`getMessage called: id=${id}`, {}, "ConnectionsStore");
      return hooks("getMessage", getMessage, { store, id });
    },
    getMessages: async (sessionId?: string) => {
      log?.debug(`getMessages called: sessionId=${sessionId ?? "*"}`, {}, "ConnectionsStore");
      return hooks("listMessages", getMessages, { store, sessionId });
    },
    clearMessages: async (sessionId?: string) => {
      log?.info(`clearMessages called: sessionId=${sessionId ?? "*"}`, {}, "ConnectionsStore");
      return hooks("clearMessages", clearMessages, { store, sessionId });
    },
    hooks,
  };

  // --- persistence -------------------------------------------------------
  // Hydration merges the persisted snapshot under live records (in-store
  // records win by id), so mutations racing hydration are never clobbered.
  // Persistence is suppressed until hydration completes so an empty initial
  // state cannot overwrite a durable snapshot.
  let hydrated = driver === undefined;

  const persist = (): void => {
    if (!driver || !hydrated) return;
    try {
      const snapshot = { sessions: store.state.sessions, messages: store.state.messages };
      void Promise.resolve(driver.set(storageKey, JSON.stringify(snapshot))).catch((e) => {
        log?.warn(`failed to persist connections snapshot: ${String(e)}`, {}, "ConnectionsStore");
      });
    } catch (e) {
      log?.warn(`failed to persist connections snapshot: ${String(e)}`, {}, "ConnectionsStore");
    }
  };

  if (driver) {
    store.subscribe(persist);
  }

  const ready: Promise<void> = driver
    ? (async () => {
        let persistedSessions: ConnectionSession[] = [];
        let persistedMessages: ConnectionMessage[] = [];
        try {
          const raw = await driver.get(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as
              | ConnectionSession[]
              | { sessions?: ConnectionSession[]; messages?: ConnectionMessage[] };
            // Legacy snapshots were the bare sessions array; current ones
            // carry both slices under `{ sessions, messages }`.
            const rawSessions = Array.isArray(parsed) ? parsed : (parsed?.sessions ?? []);
            const rawMessages = Array.isArray(parsed) ? [] : (parsed?.messages ?? []);
            // Transports do not survive restarts: coerce every hydrated
            // session to `disconnected`.
            persistedSessions = Array.isArray(rawSessions)
              ? rawSessions.map((s) => ({ ...s, status: "disconnected" as const }))
              : [];
            // An in-flight delivery cannot complete either: hydrated
            // `pending` messages are coerced to `failed`.
            persistedMessages = Array.isArray(rawMessages)
              ? rawMessages.map((m) =>
                  m.status === "pending"
                    ? { ...m, status: "failed" as const, error: "interrupted by restart" }
                    : m,
                )
              : [];
          }
        } catch (e) {
          log?.warn(`dropping corrupt connections snapshot: ${String(e)}`, {}, "ConnectionsStore");
        }
        if (persistedSessions.length > 0 || persistedMessages.length > 0) {
          store.setState((state) => {
            const liveSessions = new Set(state.sessions.map((s) => s.id));
            const liveMessages = new Set(state.messages.map((m) => m.id));
            return {
              ...state,
              sessions: [
                ...persistedSessions.filter((s) => !liveSessions.has(s.id)),
                ...state.sessions,
              ],
              messages: [
                ...persistedMessages.filter((m) => !liveMessages.has(m.id)),
                ...state.messages,
              ],
            };
          });
        }
        hydrated = true;
        persist();
      })()
    : Promise.resolve();

  return { api, store, protocols, ready };
}
