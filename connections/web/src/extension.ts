/**
 * The browser (dapp-side / requester-role) connections engine.
 *
 * A thin Provider/Extensions wrapper around `createConnectionsStore` of
 * `@algorandfoundation/connections-core`, the same pattern the
 * credentials/keystore platform packages follow. The engine carries
 * **zero protocol logic**: applications opt into connection protocols
 * via `options.connections.protocols` (e.g. `liquidAuth({...})` from
 * `@algorandfoundation/connections-liquid-auth`), and the engine routes
 * `connect(protocolId)` / `createRequest(protocolId)` through the
 * protocol registry, completing the wallet RPC handshake over whatever
 * transport the protocol establishes.
 */

import {
  createConnectionRpc,
  createConnectionsStore,
  createDomainRegistry,
  createSecureMessaging,
  discoverDomains,
  memoryConnectionDriver,
  ConnectionRpcError,
  UnknownProtocolError,
  type ConnectOptions,
  type ConnectionDomainRegistry,
  type ConnectionMessage,
  type ConnectionRequest,
  type ConnectionRpc,
  type ConnectionSession,
  type ConnectionTransport,
  type ConnectionsOptions,
  type ConnectionsStoreApi,
  type ProtocolContext,
  type ProtocolRegistry,
  type SecureChannel,
  type SecureMessaging,
} from "@algorandfoundation/connections-core";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { localStorageConnectionDriver } from "./driver.ts";

/** Encodes bytes as standard base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decodes standard base64 into bytes. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

declare module "@algorandfoundation/connections-core" {
  /**
   * Browser additions to the shared `options.connections` namespace: the
   * requester-role extras the {@link WithConnections} engine reads. The
   * `protocols`, `driver`, `store`, `hooks`, `storageKey` and `domains`
   * fields come from the base {@link ConnectionsNamespace}.
   */
  interface ConnectionsNamespace {
    /**
     * Display metadata of the dapp, sent with the `connect` RPC so the
     * wallet can show who is asking. The wallet persists it on the
     * session's `peer.metadata`.
     */
    metadata?: {
      /** Human-readable dapp name. */
      name?: string;
      /** The dapp's URL. */
      url?: string;
    };
  }
}

/**
 * Browser connections extension options.
 *
 * The same {@link ConnectionsOptions} shape; this package augments the shared
 * {@link ConnectionsNamespace} with the dapp `metadata`, so
 * `options.connections` accepts `metadata` alongside the base
 * `protocols`/`driver`/`store`/`hooks`/`storageKey`/`domains`. Sessions
 * persist to `localStorage` unless a `driver` is injected (memory when
 * `localStorage` is unavailable).
 *
 * @example
 * ```typescript
 * const options: WebConnectionsOptions = {
 *   connections: {
 *     protocols: [liquidAuth({ url: "https://liquid.example.com" })],
 *     metadata: { name: "My Dapp", url: "https://dapp.example" },
 *   },
 * };
 * ```
 */
export type WebConnectionsOptions = ConnectionsOptions;

/**
 * Per-session secure-messaging configuration registered via
 * {@link WebConnectionApi.enableSecureMessaging}.
 *
 * @remarks
 * INFORMAL contract; a proper messaging spec will come later and replace
 * it.
 *
 * @example
 * ```typescript
 * provider.connection.enableSecureMessaging(session.id, {
 *   channel: createSecureChannel({ sharedSecret }),
 *   onMessage: (message) => render(message),
 * });
 * ```
 */
export interface SecureMessagingConfig {
  /**
   * The session's {@link SecureChannel}, typically built from the
   * X25519 shared secret between the dapp's identity key and the
   * wallet's `keyAgreement` key (see `createSecureChannel`).
   */
  channel: SecureChannel;
  /** Invoked with every decrypted incoming message. */
  onMessage?(message: ConnectionMessage): void;
  /** Auto-acknowledge incoming messages (default `true`). */
  autoAcknowledge?: boolean;
}

/**
 * The connection API surface at `provider.connection`.
 *
 * @example
 * ```typescript
 * const session = await provider.connection.connect("liquid-auth", {
 *   onFallback: (request) => renderQr(request.qrData),
 * });
 * const stxns = await provider.connection.signTransactions(session.id, txns);
 * ```
 */
export interface WebConnectionApi {
  /** The session CRUD API of the connections store. */
  store: ConnectionsStoreApi;
  /** The registry of the protocols the application registered. */
  protocols: ProtocolRegistry;
  /** Resolves once persisted sessions have hydrated. */
  ready: Promise<void>;
  /**
   * Connects through the given protocol's preferred path when it has
   * one; otherwise creates the out-of-band request and surfaces it via
   * `opts.onFallback` (render `request.qrData` as a QR). Completes the
   * `connect` RPC and resolves with the connected session (peer domain
   * records included).
   */
  connect(protocolId: string, opts?: ConnectOptions): Promise<ConnectionSession>;
  /**
   * Creates a pending out-of-band request (render `request.qrData` as a
   * QR); its `establish()` completes the full handshake before resolving.
   */
  createRequest(protocolId: string): Promise<ConnectionRequest>;
  /**
   * Renegotiates a persisted session over the protocol's signaling
   * service and re-runs the `connect` RPC handshake, refreshing the
   * peer's domain records (accounts, identities, passkey and credential
   * metadata: whatever domains both sides mount).
   * No new out-of-band request is created; the requester parks on the
   * session's signaling rendezvous until the responding peer re-offers.
   * Concurrent resumes of the same session share one attempt.
   *
   * Rejects when the session is unknown, the protocol does not
   * implement resume, or the renegotiation fails (the session is then
   * marked `disconnected`).
   *
   * @param sessionId - The persisted session to resume.
   * @param opts - Abort signal and, when several protocols are
   * registered, the protocol to route through.
   */
  resume(
    sessionId: string,
    opts?: { signal?: AbortSignal; protocolId?: string },
  ): Promise<ConnectionSession>;
  /**
   * Sends `sign_transactions` over the session's live connection.
   *
   * @param sessionId - The connected session.
   * @param txns - Base64-encoded transaction msgpack, in group order.
   * @param indexesToSign - Positions to sign; all when omitted.
   * @returns Base64-encoded signed txns aligned with the input (`null` where unsigned).
   */
  signTransactions(
    sessionId: string,
    txns: string[],
    indexesToSign?: number[],
  ): Promise<(string | null)[]>;
  /**
   * Enables secure messaging for a session: registers the channel (and
   * message callbacks) and attaches the `message`/`message_ack` handler
   * to the session's live rpc, re-attached automatically whenever a
   * resume replaces the transport. Calling again replaces the previous
   * configuration.
   */
  enableSecureMessaging(sessionId: string, config: SecureMessagingConfig): void;
  /**
   * Seals and sends a text message over the session's secure channel
   * (see `createSecureMessaging`): persisted locally as `pending`,
   * `delivered` once the wallet's receipt arrives, `acknowledged` when
   * its explicit `message_ack` lands.
   *
   * Rejects with `secure_channel_unavailable` when
   * {@link WebConnectionApi.enableSecureMessaging} has not been called
   * for the session or its connection is not live.
   */
  sendSecureMessage(sessionId: string, text: string): Promise<ConnectionMessage>;
  /** Closes the session's live connection and marks it `disconnected`. */
  disconnect(sessionId: string): Promise<void>;
}

/**
 * The extension surface contributed by the browser connections package.
 *
 * @example
 * ```typescript
 * class DappProvider extends Provider<typeof DappProvider.EXTENSIONS> {
 *   static EXTENSIONS = [WithConnections] as const;
 *   connections!: WebConnectionsExtension["connections"];
 *   connection!: WebConnectionsExtension["connection"];
 * }
 * ```
 */
export interface WebConnectionsExtension {
  /** Reactive list of the connection sessions. */
  readonly connections: ConnectionSession[];
  /** The connection API (connect / resume / sign / secure messaging / disconnect). */
  connection: WebConnectionApi;
}

/**
 * Wallet Provider Extension that adds the requester-role (dapp-side)
 * connections engine.
 *
 * The extension is a thin wrapper around the shared
 * {@link import("@algorandfoundation/connections-core").createConnectionsStore}
 * engine: it reads the `options.connections` block ({@link WebConnectionsOptions}),
 * defaults persistence to `localStorage`, infers the connection domains from
 * the provider surface per handshake and routes `connect` / `createRequest` /
 * `resume` through the protocol registry, completing the wallet RPC handshake
 * over whatever transport the protocol establishes.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link WebConnectionsOptions}; every field is optional.
 *
 * @returns The {@link WebConnectionsExtension} surface: the reactive
 *   `connections` list and the `connection` API.
 *
 * @example
 * ```typescript
 * const DappProvider = Provider.withExtensions([WithConnections]);
 * const provider = new DappProvider(
 *   { id: "my-dapp", name: "My Dapp" },
 *   {
 *     connections: {
 *       protocols: [liquidAuth({ url: "https://liquid.example.com" })],
 *       metadata: { name: "My Dapp", url: "https://dapp.example" },
 *     },
 *   },
 * );
 * const session = await provider.connection.connect("liquid-auth", {
 *   onFallback: (request) => renderQr(request.qrData),
 * });
 * // Later, when the transport dropped (session is `disconnected`):
 * await provider.connection.resume(session.id);
 * ```
 */
export const WithConnections: Extension<WebConnectionsExtension> = (
  provider: Provider<any> & Partial<LogStoreExtension>,
  options: WebConnectionsOptions,
) => {
  const driver =
    options?.connections?.driver ??
    (typeof globalThis.localStorage === "undefined"
      ? memoryConnectionDriver()
      : localStorageConnectionDriver());

  const { api, store, protocols, ready } = createConnectionsStore({
    store: options?.connections?.store,
    hooks: options?.connections?.hooks,
    driver,
    storageKey: options?.connections?.storageKey,
    protocols: options?.connections?.protocols,
    log: provider.log,
  });

  /**
   * The session's domain registry, built lazily PER CALL: domains are
   * inferred from the provider surface at handshake time (unless an
   * explicit `options.connections.domains` list overrides the
   * inference), so the extension application order never matters;
   * `WithConnections` may well be applied before any store extension.
   */
  const domainRegistry = (): ConnectionDomainRegistry =>
    createDomainRegistry(options?.connections?.domains ?? discoverDomains(provider), {
      log: provider.log,
    });

  const ctx: ProtocolContext = {
    sessions: api,
    log: provider.log,
    get domains(): ConnectionDomainRegistry {
      return domainRegistry();
    },
  };
  const metadata = options?.connections?.metadata;

  // Live rpcs by session id: runtime state, never persisted.
  const rpcs = new Map<string, ConnectionRpc>();

  // In-flight resumes by session id, so concurrent calls share one attempt.
  const resumes = new Map<string, Promise<ConnectionSession>>();

  // Secure-messaging state by session id: the registered configuration
  // (survives transport swaps) and the layer attached to the CURRENT rpc.
  const messagingConfigs = new Map<string, SecureMessagingConfig>();
  const messagings = new Map<string, SecureMessaging>();

  /**
   * (Re)attaches the secure-messaging layer of a session to an rpc,
   * called when messaging is enabled on a live connection and after
   * every handshake, since a resume replaces the rpc.
   */
  const attachMessaging = (sessionId: string, rpc: ConnectionRpc): void => {
    const config = messagingConfigs.get(sessionId);
    if (!config) return;
    const messaging = createSecureMessaging({
      rpc,
      channel: config.channel,
      sessionId,
      messages: api,
      onMessage: config.onMessage,
      autoAcknowledge: config.autoAcknowledge,
    });
    messaging.attach();
    messagings.set(sessionId, messaging);
  };

  const resolveProtocolId = (protocolId?: string): string => {
    if (protocolId) return protocolId;
    const ids = protocols.ids();
    if (ids.length === 1) return ids[0];
    throw new UnknownProtocolError(
      protocolId ?? "",
      ids.length === 0
        ? "no connection protocols are registered"
        : `multiple protocols are registered (${ids.join(", ")}); pass a protocolId`,
    );
  };

  /**
   * The session-routed signer the domain mirrors re-attach to received
   * records: `sign(txns)` becomes the connection's `sign_transactions`
   * RPC (over the session's CURRENT rpc, so it survives resumes); the
   * same store shape as a local record, different `sign` backing.
   */
  const sessionSigner =
    (sessionId: string) =>
    (_record: unknown) =>
    async (txns: Uint8Array[]): Promise<Uint8Array[]> => {
      const rpc = rpcs.get(sessionId);
      if (!rpc) {
        throw new ConnectionRpcError(
          "transport_closed",
          `no live connection for session ${sessionId}`,
        );
      }
      const result = await rpc.request("sign_transactions", { txns: txns.map(bytesToBase64) });
      return result.stxns.map((stxn, index) => {
        if (stxn === null) {
          throw new ConnectionRpcError("rejected", `the peer did not sign transaction ${index}`);
        }
        return base64ToBytes(stxn);
      });
    };

  /**
   * Completes the wallet RPC handshake over an established transport:
   * builds the rpc, performs `connect` (announcing/exposing this side's
   * domains), records the peer's `domains` map on the session, and
   * routes the peer's records into the mounted domain stores with the
   * session-routed signer attached.
   */
  const handshake = async (
    sessionId: string,
    transport: ConnectionTransport,
  ): Promise<ConnectionSession> => {
    const domains = domainRegistry();
    const rpc = createConnectionRpc(transport);
    rpcs.set(sessionId, rpc);
    transport.onStateChange((state) => {
      // Only act when this rpc is still the session's current one; a
      // stale transport of a previous negotiation may close after a
      // resume already replaced it.
      if (state === "closed" && rpcs.get(sessionId) === rpc) {
        rpcs.delete(sessionId);
        messagings.delete(sessionId);
        void api.updateSessionStatus(sessionId, "disconnected");
        // The link is gone: clear the session's mirrored domain records.
        void domainRegistry().revoke(sessionId);
      }
    });
    const exposed = await domains.expose();
    const result = await rpc.request("connect", {
      ...(metadata ? { metadata } : {}),
      ...(Object.keys(exposed).length > 0 ? { domains: exposed } : {}),
    });
    const existing = await api.getSession(sessionId);
    const now = Date.now();
    const session: ConnectionSession = {
      id: sessionId,
      origin: existing?.origin ?? "unknown",
      status: "connected",
      peer: {
        domains: result.domains ?? {},
        ...(result.metadata ? { metadata: result.metadata } : {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await api.upsertSession(session);
    // Mirror the peer's records into the mounted domain stores; the
    // registry logs-and-skips per-domain failures, so a bad payload
    // never fails the handshake.
    await domains.receive(sessionId, result.domains ?? {}, { sign: sessionSigner(sessionId) });
    // A resume replaced the rpc: re-attach the session's messaging layer.
    attachMessaging(sessionId, rpc);
    return session;
  };

  const connection: WebConnectionApi = {
    store: api,
    protocols,
    ready,

    async connect(protocolId: string, opts: ConnectOptions = {}): Promise<ConnectionSession> {
      const requester = protocols.createRequester(protocolId, ctx);
      if (requester.connect) {
        const { sessionId, transport } = await requester.connect(opts);
        return handshake(sessionId, transport);
      }
      // No preferred path: fall straight back to the out-of-band request.
      const request = await requester.createRequest();
      opts.onFallback?.(request);
      const transport = await request.establish({ signal: opts.signal });
      return handshake(request.id, transport);
    },

    async createRequest(protocolId: string): Promise<ConnectionRequest> {
      const requester = protocols.createRequester(protocolId, ctx);
      const request = await requester.createRequest();
      return {
        ...request,
        // Wrap establish so the wallet RPC handshake always completes
        // before the caller sees the transport.
        establish: async (opts?: { signal?: AbortSignal }): Promise<ConnectionTransport> => {
          const transport = await request.establish(opts);
          await handshake(request.id, transport);
          return transport;
        },
      };
    },

    async resume(
      sessionId: string,
      opts: { signal?: AbortSignal; protocolId?: string } = {},
    ): Promise<ConnectionSession> {
      const inFlight = resumes.get(sessionId);
      if (inFlight) return inFlight;

      const attempt = (async (): Promise<ConnectionSession> => {
        const session = await api.getSession(sessionId);
        if (!session) {
          throw new Error(`no session ${sessionId} to resume`);
        }
        const protocolId = resolveProtocolId(opts.protocolId);
        const requester = protocols.createRequester(protocolId, ctx);
        if (!requester.resume) {
          throw new Error(`protocol ${protocolId} does not implement resume`);
        }
        await api.updateSessionStatus(sessionId, "connecting");
        try {
          const transport = await requester.resume(session, { signal: opts.signal });
          return await handshake(sessionId, transport);
        } catch (error) {
          // A resume that failed or timed out is just still disconnected.
          await api.updateSessionStatus(sessionId, "disconnected");
          throw error;
        }
      })();

      resumes.set(sessionId, attempt);
      try {
        return await attempt;
      } finally {
        resumes.delete(sessionId);
      }
    },

    async signTransactions(
      sessionId: string,
      txns: string[],
      indexesToSign?: number[],
    ): Promise<(string | null)[]> {
      const rpc = rpcs.get(sessionId);
      if (!rpc) {
        throw new ConnectionRpcError(
          "transport_closed",
          `no live connection for session ${sessionId}`,
        );
      }
      const result = await rpc.request("sign_transactions", {
        txns,
        ...(indexesToSign ? { indexesToSign } : {}),
      });
      return result.stxns;
    },

    enableSecureMessaging(sessionId: string, config: SecureMessagingConfig): void {
      messagingConfigs.set(sessionId, config);
      const rpc = rpcs.get(sessionId);
      if (rpc) attachMessaging(sessionId, rpc);
    },

    async sendSecureMessage(sessionId: string, text: string): Promise<ConnectionMessage> {
      const messaging = messagings.get(sessionId);
      if (!messaging) {
        throw new ConnectionRpcError(
          "secure_channel_unavailable",
          `secure messaging is not enabled for a live session ${sessionId}`,
        );
      }
      return messaging.send(text);
    },

    async disconnect(sessionId: string): Promise<void> {
      const rpc = rpcs.get(sessionId);
      rpcs.delete(sessionId);
      messagings.delete(sessionId);
      rpc?.close();
      await api.updateSessionStatus(sessionId, "disconnected");
      // The session ended: clear its mirrored domain records.
      await domainRegistry().revoke(sessionId);
    },
  };

  return {
    /** Reactive list of the connection sessions. */
    get connections() {
      return store.state.sessions;
    },
    connection,
  } as WebConnectionsExtension;
};
