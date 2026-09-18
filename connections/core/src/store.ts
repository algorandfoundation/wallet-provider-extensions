import type { Store } from "@tanstack/store";
import type {
  ConnectionMessage,
  ConnectionMessageStatus,
  ConnectionSession,
  ConnectionSessionStatus,
  ConnectionsState,
} from "./types.ts";

/**
 * Adds (or replaces by id) a session in the store.
 *
 * @example
 * ```typescript
 * upsertSession({ store, session });
 * ```
 */
export function upsertSession({
  store,
  session,
}: {
  store: Store<ConnectionsState>;
  session: ConnectionSession;
}): ConnectionSession {
  store.setState((state) => {
    const filtered = state.sessions.filter((s) => s.id !== session.id);
    return {
      ...state,
      sessions: [session, ...filtered],
    };
  });
  return session;
}

/**
 * Updates the status of a session (bumping `updatedAt`), optionally
 * recording an error detail. Unknown ids are a no-op.
 *
 * @example
 * ```typescript
 * updateSessionStatus({ store, id, status: "failed", error: "signaling lost" });
 * ```
 */
export function updateSessionStatus({
  store,
  id,
  status,
  error,
}: {
  store: Store<ConnectionsState>;
  id: string;
  status: ConnectionSessionStatus;
  error?: string;
}): ConnectionSession | undefined {
  let updated: ConnectionSession | undefined;
  store.setState((state) => ({
    ...state,
    sessions: state.sessions.map((s) => {
      if (s.id !== id) return s;
      updated = { ...s, status, error, updatedAt: Date.now() };
      return updated;
    }),
  }));
  return updated;
}

/**
 * Removes a session by id.
 *
 * @example
 * ```typescript
 * removeSession({ store, id });
 * ```
 */
export function removeSession({ store, id }: { store: Store<ConnectionsState>; id: string }): void {
  store.setState((state) => ({
    ...state,
    sessions: state.sessions.filter((s) => s.id !== id),
  }));
}

/**
 * Clears all sessions.
 *
 * @example
 * ```typescript
 * clearSessions({ store });
 * ```
 */
export function clearSessions({ store }: { store: Store<ConnectionsState> }): void {
  store.setState((state) => ({
    ...state,
    sessions: [],
  }));
}

/**
 * Retrieves a session by id.
 *
 * @example
 * ```typescript
 * const session = getSession({ store, id });
 * ```
 */
export function getSession({
  store,
  id,
}: {
  store: Store<ConnectionsState>;
  id: string;
}): ConnectionSession | undefined {
  return store.state.sessions.find((s) => s.id === id);
}

/**
 * Lists all sessions currently tracked by the store.
 *
 * @example
 * ```typescript
 * const sessions = getSessions({ store });
 * ```
 */
export function getSessions({ store }: { store: Store<ConnectionsState> }): ConnectionSession[] {
  return store.state.sessions;
}

/**
 * Adds (or replaces by id) a message in the store. Messages append in
 * arrival order, so the slice stays oldest-first.
 *
 * @example
 * ```typescript
 * upsertMessage({ store, message });
 * ```
 */
export function upsertMessage({
  store,
  message,
}: {
  store: Store<ConnectionsState>;
  message: ConnectionMessage;
}): ConnectionMessage {
  store.setState((state) => {
    const exists = state.messages.some((m) => m.id === message.id);
    return {
      ...state,
      messages: exists
        ? state.messages.map((m) => (m.id === message.id ? message : m))
        : [...state.messages, message],
    };
  });
  return message;
}

/**
 * Updates the status of a message (bumping `updatedAt`), optionally
 * recording an error detail. Unknown ids are a no-op.
 *
 * `acknowledged` is terminal: an explicit ack may race ahead of the
 * delivery receipt (both travel the same duplex rpc), so a later
 * `delivered`/`received` update never downgrades it.
 *
 * @example
 * ```typescript
 * updateMessageStatus({ store, id, status: "delivered" });
 * ```
 */
export function updateMessageStatus({
  store,
  id,
  status,
  error,
}: {
  store: Store<ConnectionsState>;
  id: string;
  status: ConnectionMessageStatus;
  error?: string;
}): ConnectionMessage | undefined {
  let updated: ConnectionMessage | undefined;
  store.setState((state) => ({
    ...state,
    messages: state.messages.map((m) => {
      if (m.id !== id) return m;
      if (m.status === "acknowledged" && (status === "delivered" || status === "received")) {
        updated = m;
        return m;
      }
      updated = { ...m, status, error, updatedAt: Date.now() };
      return updated;
    }),
  }));
  return updated;
}

/**
 * Retrieves a message by id.
 *
 * @example
 * ```typescript
 * const message = getMessage({ store, id });
 * ```
 */
export function getMessage({
  store,
  id,
}: {
  store: Store<ConnectionsState>;
  id: string;
}): ConnectionMessage | undefined {
  return store.state.messages.find((m) => m.id === id);
}

/**
 * Lists the messages of one session (all messages when `sessionId` is
 * omitted), oldest first.
 *
 * @example
 * ```typescript
 * const thread = getMessages({ store, sessionId });
 * ```
 */
export function getMessages({
  store,
  sessionId,
}: {
  store: Store<ConnectionsState>;
  sessionId?: string;
}): ConnectionMessage[] {
  const messages = store.state.messages;
  return sessionId === undefined ? messages : messages.filter((m) => m.sessionId === sessionId);
}

/**
 * Clears the messages of one session (all messages when `sessionId` is
 * omitted).
 *
 * @example
 * ```typescript
 * clearMessages({ store, sessionId });
 * ```
 */
export function clearMessages({
  store,
  sessionId,
}: {
  store: Store<ConnectionsState>;
  sessionId?: string;
}): void {
  store.setState((state) => ({
    ...state,
    messages:
      sessionId === undefined ? [] : state.messages.filter((m) => m.sessionId !== sessionId),
  }));
}
