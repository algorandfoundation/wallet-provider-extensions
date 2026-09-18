import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import type { ConnectionDomains } from "./domains.ts";
import type { ConnectionKeyValueStore } from "./engine.ts";
import type { ConnectionProtocol } from "./protocol.ts";

/**
 * The `options.connections` namespace the platform `WithConnections`
 * engines claim on the shared {@link ExtensionOptions} registry.
 *
 * This is the platform-neutral half of the two-level registry: the fields
 * both the browser (`@algorandfoundation/connections-web`) and the React
 * Native (`@algorandfoundation/react-native-connections`) engines read when
 * they build the {@link import("./engine.ts").createConnectionsStore} engine.
 * The platform packages **augment** this interface with their own extras
 * (e.g. the dapp `metadata` the browser requester sends with `connect`), so
 * a composition root gets one fully typed `options.connections` block
 * whichever platform it installs.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/connections-core" {
 *   interface ConnectionsNamespace {
 *     metadata?: { name?: string; url?: string };
 *   }
 * }
 * ```
 */
export interface ConnectionsNamespace {
  /**
   * Connection protocols the application opts into (e.g.
   * `liquidAuth({...})` from `@algorandfoundation/connections-liquid-auth`).
   * The engines route `connect(protocolId)` / `accept(uri, protocolId)`
   * through the resulting {@link import("./protocol.ts").ProtocolRegistry}.
   */
  protocols?: ConnectionProtocol[];
  /**
   * Persistence driver for the sessions/messages snapshot. Each platform
   * picks its own default (`localStorage` in the browser, memory on React
   * Native); any two-method {@link ConnectionKeyValueStore} works.
   */
  driver?: ConnectionKeyValueStore;
  /** Reactive store override; a fresh empty store is created when omitted. */
  store?: Store<ConnectionsState>;
  /** Hook collection threaded into the engine (every store operation is interceptable). */
  hooks?: HookCollection<any>;
  /** Storage key override; defaults to `DEFAULT_CONNECTIONS_KEY`. */
  storageKey?: string;
  /**
   * The connection domains this side announces and exchanges during
   * `connect`. By default they are INFERRED from the provider surface
   * (see {@link import("./domains.ts").discoverDomains}): every mounted
   * store extension (`provider.account.store`, `provider.identity.store`,
   * `provider.passkey.store`, `provider.credential.store`) announces its
   * domain, exchanging records through the `remote` mirror the domain's
   * connections bridge mounts next to the store; apps declare nothing.
   * Pass an explicit list to override or extend the inferred set (e.g. a
   * custom `defineDomain({...})`).
   */
  domains?: ConnectionDomains;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Connections-specific settings, see {@link ConnectionsNamespace}. */
    connections?: ConnectionsNamespace;
  }
}

/**
 * Configuration for the platform `WithConnections` extensions.
 *
 * Narrows the shared {@link ExtensionOptions} registry to the
 * `connections` block. Every field is optional: an engine mounted with no
 * options is in-memory and hosts no protocol until one is registered.
 *
 * @example
 * ```typescript
 * const options: ConnectionsOptions = {
 *   connections: {
 *     protocols: [liquidAuth({ url: "https://liquid.example.com" })],
 *     driver: memoryConnectionDriver(),
 *   },
 * };
 * ```
 */
export interface ConnectionsOptions extends ExtensionOptions {
  /** Connections-specific settings. */
  connections?: ConnectionsNamespace;
}

/**
 * The lifecycle status of a {@link ConnectionSession}.
 *
 * - `pending`: the session exists locally but no transport work has started.
 * - `authenticating`: the transport is performing its handshake (e.g. liquid-auth).
 * - `connecting`: the message channel is being established.
 * - `connected`: the channel is open and the peer has completed `connect`.
 * - `disconnected`: the channel closed (also the status every persisted
 *   session is coerced to on hydration, since transports do not survive restarts).
 * - `failed`: the session errored; see {@link ConnectionSession.error}.
 *
 * @example
 * ```typescript
 * const live = provider.connections.filter((s) => s.status === "connected");
 * ```
 */
export type ConnectionSessionStatus =
  | "pending"
  | "authenticating"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

/**
 * A remote dapp ↔ wallet connection session tracked by the connections store.
 *
 * Sessions are the durable record of a connection: which origin asked,
 * what state the link is in, and (once connected) which domain records
 * and metadata the peer exposed. The live transport itself is never
 * stored; it is ephemeral runtime state owned by the transport package.
 *
 * @example
 * ```typescript
 * const session = await provider.connection.store.getSession(sessionId);
 * const peerAccounts = session?.peer?.domains.accounts ?? [];
 * ```
 */
export interface ConnectionSession {
  /** Stable wallet-local identifier for the session. */
  id: string;
  /** Origin of the remote peer (e.g. the dapp's `https://...` origin). */
  origin: string;
  /** Current lifecycle status. */
  status: ConnectionSessionStatus;
  /** Peer details learned during `connect` (wallet side: the dapp; dapp side: the wallet). */
  peer?: {
    /**
     * Records the peer exposed for this session, keyed by domain id
     * (e.g. `accounts`, `identities`, `passkeys`, `credentials`; see
     * the `ConnectionDomain` seam of `domains.ts`). The keys double as
     * the peer's supported-domain announcement, persisted across
     * restarts: an empty array means "supported, nothing shared".
     */
    domains: Record<string, unknown[]>;
    /** Display metadata of the peer. */
    metadata?: {
      name?: string;
      icon?: string;
    };
  };
  /** Timestamp the session was created. */
  createdAt: number;
  /** Timestamp of the last status or peer change. */
  updatedAt: number;
  /** Failure detail when {@link ConnectionSession.status} is `failed`. */
  error?: string;
}

/**
 * The delivery status of a {@link ConnectionMessage}.
 *
 * Outgoing: `pending` → `delivered` (the peer's `message` response
 * confirmed receipt) → `acknowledged` (the peer sent an explicit
 * `message_ack`), or `failed`. Incoming: `received` → `acknowledged`
 * (this side sent the `message_ack`).
 *
 * @remarks
 * This is an INFORMAL contract. A proper messaging spec will replace it;
 * the statuses are deliberately coarse until then.
 */
export type ConnectionMessageStatus =
  | "pending"
  | "delivered"
  | "received"
  | "acknowledged"
  | "failed";

/**
 * One message exchanged over a session's secure channel, persisted by
 * the connections store so conversations survive restarts.
 *
 * The wire carries only the sealed ciphertext (see
 * {@link SecureMessageParams}); the store keeps the local plaintext, as
 * encryption protects the transport, not the wallet's own storage.
 *
 * @example
 * ```typescript
 * const thread = await provider.connection.store.getMessages(sessionId);
 * const unread = thread.filter((m) => m.direction === "incoming" && m.status === "received");
 * ```
 */
export interface ConnectionMessage {
  /** Message id, shared by both peers (assigned by the sender). */
  id: string;
  /** The id of the {@link ConnectionSession} the message belongs to. */
  sessionId: string;
  /** Whether this side sent or received the message. */
  direction: "outgoing" | "incoming";
  /** The plaintext content (UTF-8). */
  text: string;
  /** Current delivery status. */
  status: ConnectionMessageStatus;
  /** Timestamp the message was created locally. */
  createdAt: number;
  /** Timestamp of the last status change. */
  updatedAt: number;
  /** Failure detail when {@link ConnectionMessage.status} is `failed`. */
  error?: string;
}

/**
 * The state of the connections store.
 *
 * @example
 * ```typescript
 * const store = new Store<ConnectionsState>({ sessions: [], messages: [] });
 * ```
 */
export interface ConnectionsState {
  /** Every {@link ConnectionSession} tracked by the store, newest first. */
  sessions: ConnectionSession[];
  /** Every persisted {@link ConnectionMessage}, oldest first. */
  messages: ConnectionMessage[];
}

/**
 * Session CRUD API exposed by the connections store engine.
 *
 * Every mutation is wrapped in the engine's hook collection, so
 * applications can intercept operations via `before`/`after` hooks.
 *
 * @example
 * ```typescript
 * provider.connection.store.hooks.after("upsert", (_result, { session }) => {
 *   console.log("session tracked", session.id);
 * });
 * ```
 */
export interface ConnectionsStoreApi {
  /** Adds (or replaces by id) a session in the store. */
  upsertSession: (session: ConnectionSession) => Promise<ConnectionSession>;
  /** Updates the status (and optional error detail) of a session, bumping `updatedAt`. */
  updateSessionStatus: (
    id: string,
    status: ConnectionSessionStatus,
    error?: string,
  ) => Promise<ConnectionSession | undefined>;
  /** Removes a session by id. */
  removeSession: (id: string) => Promise<void>;
  /** Clears all sessions. */
  clearSessions: () => Promise<void>;
  /** Retrieves a session by id. */
  getSession: (id: string) => Promise<ConnectionSession | undefined>;
  /** Lists all sessions currently tracked by the store. */
  getSessions: () => Promise<ConnectionSession[]>;
  /** Adds (or replaces by id) a message in the store. */
  upsertMessage: (message: ConnectionMessage) => Promise<ConnectionMessage>;
  /** Updates the status (and optional error detail) of a message, bumping `updatedAt`. */
  updateMessageStatus: (
    id: string,
    status: ConnectionMessageStatus,
    error?: string,
  ) => Promise<ConnectionMessage | undefined>;
  /** Retrieves a message by id. */
  getMessage: (id: string) => Promise<ConnectionMessage | undefined>;
  /** Lists the messages of one session (all messages when omitted), oldest first. */
  getMessages: (sessionId?: string) => Promise<ConnectionMessage[]>;
  /** Clears the messages of one session (all messages when omitted). */
  clearMessages: (sessionId?: string) => Promise<void>;
  /** Hooks for connections store operations. */
  hooks: HookCollection<any>;
}

/**
 * Connectivity state of a {@link ConnectionTransport}.
 *
 * @example
 * ```typescript
 * transport.onStateChange((state) => {
 *   if (state === "closed") cleanup();
 * });
 * ```
 */
export type ConnectionTransportState = "connecting" | "open" | "closed";

/**
 * The message-channel contract the connections RPC layer runs over.
 *
 * Any ordered, string-based duplex channel can implement it: a WebRTC
 * data channel (the first real transport, via liquid-auth), a WebSocket,
 * or an in-memory pair (see `createInMemoryTransportPair`) for tests and
 * demos. Transports are ephemeral: they never outlive the process and
 * are not persisted with the {@link ConnectionSession} they serve.
 *
 * @example
 * ```typescript
 * const transport: ConnectionTransport = dataChannelTransport(channel);
 * const rpc = createConnectionRpc(transport);
 * ```
 */
export interface ConnectionTransport {
  /** Current connectivity state of the channel. */
  readonly state: ConnectionTransportState;
  /** Sends a string frame to the remote peer. */
  send(data: string): void;
  /**
   * Subscribes to incoming frames.
   *
   * @returns An unsubscribe function.
   */
  onMessage(cb: (data: string) => void): () => void;
  /**
   * Subscribes to {@link ConnectionTransportState} changes.
   *
   * @returns An unsubscribe function.
   */
  onStateChange(cb: (state: ConnectionTransportState) => void): () => void;
  /** Closes the channel; the state transitions to `closed`. */
  close(): void;
}

/**
 * A versioned wallet RPC request envelope, serialized as JSON over the
 * {@link ConnectionTransport}.
 *
 * @example
 * ```typescript
 * const envelope: ConnectionRequestEnvelope = {
 *   v: 1,
 *   kind: "request",
 *   id: crypto.randomUUID(),
 *   method: "connect",
 *   params: { metadata: { name: "My Dapp" } },
 * };
 * ```
 */
export interface ConnectionRequestEnvelope {
  /** Envelope version; always `1` for now. */
  v: 1;
  kind: "request";
  /** Correlation id echoed back in the matching {@link ConnectionResponseEnvelope}. */
  id: string;
  /** Method name (see {@link ConnectionMethodMap} for the known methods). */
  method: string;
  /** Method parameters. */
  params: unknown;
}

/**
 * A versioned wallet RPC response envelope, serialized as JSON over the
 * {@link ConnectionTransport}. Exactly one of `result` or `error` is set.
 *
 * @example
 * ```typescript
 * const envelope: ConnectionResponseEnvelope = {
 *   v: 1,
 *   kind: "response",
 *   id: request.id,
 *   error: { code: "rejected", message: "user denied the connection" },
 * };
 * ```
 */
export interface ConnectionResponseEnvelope {
  /** Envelope version; always `1` for now. */
  v: 1;
  kind: "response";
  /** Correlation id of the {@link ConnectionRequestEnvelope} being answered. */
  id: string;
  /** Successful result payload. */
  result?: unknown;
  /** Failure payload; `code` maps onto `ConnectionRpcError.code`. */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Parameters of the `connect` method, where the dapp introduces itself.
 *
 * @example
 * ```typescript
 * const result = await rpc.request("connect", {
 *   metadata: { name: "My Dapp", url: "https://dapp.example" },
 * });
 * ```
 */
export interface ConnectParams {
  /** Display metadata of the requesting dapp. */
  metadata?: {
    name?: string;
    url?: string;
  };
  /**
   * Records the dapp announces and exposes alongside its metadata,
   * keyed by domain id (the mirror of {@link ConnectResult.domains}).
   * The `identities` records keep riding here: their DID documents
   * carry the `keyAgreement` keys the wallet derives the session's
   * secure channel from (see `createSecureChannel`), so secure
   * messaging can run in BOTH directions.
   *
   * @remarks
   * Optional and INFORMAL: the upcoming negotiation work will formalize
   * the exchange.
   */
  domains?: Record<string, unknown[]>;
}

/**
 * Result of the `connect` method: the records the wallet exposes by
 * domain id, plus its display metadata.
 *
 * @example
 * ```typescript
 * const { domains, metadata } = await rpc.request("connect", {});
 * console.log(metadata?.name, Object.keys(domains)); // "My Wallet" ["accounts", "identities"]
 * ```
 */
export interface ConnectResult {
  /**
   * Records the wallet exposes to the dapp for this session, keyed by
   * domain id. The keys double as the wallet's supported-domain
   * announcement; an empty array means "supported, nothing shared".
   */
  domains: Record<string, unknown[]>;
  /** Display metadata of the wallet. */
  metadata?: {
    name?: string;
    icon?: string;
  };
}

/**
 * Parameters of the `sign_transactions` method.
 *
 * Transactions travel as base64-encoded transaction msgpack, mirroring
 * ARC-0001's wire shape so transports stay JSON-only.
 *
 * @example
 * ```typescript
 * const { stxns } = await rpc.request("sign_transactions", { txns, indexesToSign: [0] });
 * ```
 */
export interface SignTransactionsParams {
  /** Base64-encoded transaction msgpack, in group order. */
  txns: string[];
  /** Positions in {@link SignTransactionsParams.txns} the wallet should sign; all when omitted. */
  indexesToSign?: number[];
}

/**
 * Result of the `sign_transactions` method.
 *
 * @example
 * ```typescript
 * const { stxns } = await rpc.request("sign_transactions", { txns });
 * const signed = stxns.filter((stxn): stxn is string => stxn !== null);
 * ```
 */
export interface SignTransactionsResult {
  /**
   * Base64-encoded signed transaction msgpack, aligned position-for-position
   * with the input `txns`; `null` where the wallet did not sign.
   */
  stxns: (string | null)[];
}

/**
 * Parameters of the `message` method: one sealed frame of the secure
 * channel two peers derive from their identities' `keyAgreement` keys.
 *
 * Only ciphertext travels the wire: the payload is XChaCha20-Poly1305
 * under the HKDF-derived shared key (see `createSecureChannel`), so the
 * signaling/transport layer never sees the message content.
 *
 * @remarks
 * INFORMAL contract; a proper messaging spec will replace this frame shape.
 *
 * @example
 * ```typescript
 * const sealed = channel.encrypt("hello");
 * await rpc.request("message", { id: crypto.randomUUID(), ...sealed });
 * ```
 */
export interface SecureMessageParams {
  /** Sender-assigned message id, echoed back by acks. */
  id: string;
  /** The 24-byte XChaCha20 nonce, base64url (unpadded). */
  nonce: string;
  /** The sealed payload (ciphertext + Poly1305 tag), base64url (unpadded). */
  ciphertext: string;
}

/**
 * Result of the `message` method, the receiver's delivery receipt: the
 * message was decrypted and persisted on the remote side.
 *
 * @example
 * ```typescript
 * const receipt = await rpc.request("message", params);
 * if (receipt.received) await api.updateMessageStatus(receipt.id, "delivered");
 * ```
 */
export interface SecureMessageResult {
  /** The id of the received message. */
  id: string;
  /** Always `true`: the message was decrypted and stored. */
  received: true;
}

/**
 * Parameters of the `message_ack` method: the receiver's explicit
 * acknowledgement of an earlier `message`.
 *
 * @remarks
 * INFORMAL ack process; a future messaging spec will formalize it.
 *
 * @example
 * ```typescript
 * await rpc.request("message_ack", { id: message.id });
 * ```
 */
export interface MessageAckParams {
  /** The id of the message being acknowledged. */
  id: string;
}

/**
 * Result of the `message_ack` method.
 *
 * @example
 * ```typescript
 * const { acknowledged } = await rpc.request("message_ack", { id: message.id });
 * ```
 */
export interface MessageAckResult {
  /** The id of the acknowledged message. */
  id: string;
  /** Always `true`: the sender recorded the acknowledgement. */
  acknowledged: true;
}

/**
 * Map of the known wallet RPC methods to their param/result types.
 *
 * Used to give `ConnectionRpc.request` end-to-end typing; new methods
 * extend this map in future revisions of the envelope.
 *
 * @example
 * ```typescript
 * type ConnectResultType = ConnectionMethodMap["connect"]["result"]; // ConnectResult
 * ```
 */
export interface ConnectionMethodMap {
  connect: { params: ConnectParams; result: ConnectResult };
  sign_transactions: { params: SignTransactionsParams; result: SignTransactionsResult };
  message: { params: SecureMessageParams; result: SecureMessageResult };
  message_ack: { params: MessageAckParams; result: MessageAckResult };
}

/**
 * The names of the known wallet RPC methods.
 *
 * @example
 * ```typescript
 * const method: ConnectionMethod = "sign_transactions";
 * ```
 */
export type ConnectionMethod = keyof ConnectionMethodMap;

/**
 * Resolves the parameter type of a method; `unknown` for methods outside
 * {@link ConnectionMethodMap} (forward compatibility).
 *
 * @example
 * ```typescript
 * type Params = ConnectionMethodParams<"connect">; // ConnectParams
 * ```
 */
export type ConnectionMethodParams<M extends string> = M extends ConnectionMethod
  ? ConnectionMethodMap[M]["params"]
  : unknown;

/**
 * Resolves the result type of a method; `unknown` for methods outside
 * {@link ConnectionMethodMap} (forward compatibility).
 *
 * @example
 * ```typescript
 * type Result = ConnectionMethodResult<"connect">; // ConnectResult
 * ```
 */
export type ConnectionMethodResult<M extends string> = M extends ConnectionMethod
  ? ConnectionMethodMap[M]["result"]
  : unknown;
