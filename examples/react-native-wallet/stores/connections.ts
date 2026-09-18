import { Store } from "@tanstack/store";
import type { ConnectionKeyValueStore, ConnectionsState } from "@algorandfoundation/connections";
import { localStorage } from "./mmkv-local";

/**
 * The single source of truth for remote dapp connections in the
 * application. Hydration and persistence are owned by the connections
 * engine, which reads/writes MMKV through {@link connectionsDriver};
 * persisted sessions hydrate as `disconnected` (transports never survive
 * restarts).
 */
export const connectionsStore = new Store<ConnectionsState>({
  sessions: [],
  messages: [],
});

/**
 * Two-line MMKV adapter for the engine's `ConnectionKeyValueStore`
 * persistence seam.
 */
export const connectionsDriver: ConnectionKeyValueStore = {
  get: (key) => localStorage.getString(key),
  set: (key, value) => localStorage.set(key, value),
};
