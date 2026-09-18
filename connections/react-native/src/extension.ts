/**
 * The React Native (wallet-side / responder-role) connections engine.
 *
 * A thin Provider/Extensions wrapper around `createConnectionsStore` of
 * `@algorandfoundation/connections-core`, carrying **zero protocol
 * logic**: applications register protocols (e.g. `liquidAuth({...})`
 * with wallet seams), and the engine routes `accept(uri)` for
 * scanned/pasted requests (plus `resume(sessionId)` for renegotiating
 * persisted sessions over the protocol's signaling service, and
 * `disconnect`) through the protocol registry.
 */

import {
  createConnectionsStore,
  createDomainRegistry,
  discoverDomains,
  memoryConnectionDriver,
  UnknownProtocolError,
  type ConnectionDomainRegistry,
  type ConnectionResponder,
  type ConnectionSession,
  type ConnectionTransport,
  type ConnectionsOptions,
  type ConnectionsStoreApi,
  type ProtocolContext,
  type ProtocolRegistry,
} from "@algorandfoundation/connections-core";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

/**
 * React Native connections extension options.
 *
 * The same {@link ConnectionsOptions} shape: the responder-role engine reads
 * exactly the platform-neutral `options.connections` fields of the shared
 * {@link import("@algorandfoundation/connections-core").ConnectionsNamespace}
 * (`protocols`, `driver`, `store`, `hooks`, `storageKey`, `domains`) and adds
 * none of its own. Sessions are held in memory unless a durable `driver`
 * (e.g. an MMKV wrapper) is injected. Protocol responders consume the domain
 * registry via `ProtocolContext.domains`.
 *
 * @example
 * ```typescript
 * const options: ReactNativeConnectionsOptions = {
 *   connections: {
 *     protocols: [liquidAuth({ authSigner, wallet: { signTransactions } })],
 *     driver: mmkvConnectionDriver,
 *   },
 * };
 * ```
 */
export type ReactNativeConnectionsOptions = ConnectionsOptions;

/**
 * The connection API surface at `provider.connection`.
 *
 * @example
 * ```typescript
 * await provider.connection.ready;
 * const session = await provider.connection.accept(scannedLiquidUri);
 * ```
 */
export interface ReactNativeConnectionApi {
  /** The session CRUD API of the connections store. */
  store: ConnectionsStoreApi;
  /** The registry of the protocols the wallet registered. */
  protocols: ProtocolRegistry;
  /**
   * Resolves once persisted sessions have hydrated (coerced to
   * `disconnected`, since transports never survive restarts).
   */
  ready: Promise<void>;
  /**
   * Accepts an inbound connection request (scanned/pasted URI or
   * protocol payload) and resolves with the connected session.
   *
   * @param request - The request payload (e.g. a `liquid://` URI).
   * @param protocolId - The protocol to route through; may be omitted
   * when exactly one protocol is registered.
   */
  accept(request: string, protocolId?: string): Promise<ConnectionSession>;
  /**
   * Renegotiates a persisted (disconnected) session over the protocol's
   * signaling service: the wallet side re-offers to the waiting peer,
   * reusing the still-authenticated signaling session where the
   * protocol supports it: no new out-of-band request, no repeated
   * authentication ceremony. Concurrent resumes of the same session
   * share one attempt.
   *
   * Rejects when the session is unknown or the protocol does not
   * implement resume.
   *
   * @param sessionId - The persisted session to resume.
   * @param protocolId - The protocol to route through; may be omitted
   * when exactly one protocol is registered.
   */
  resume(sessionId: string, protocolId?: string): Promise<ConnectionSession>;
  /** Closes the session's live connection and marks it `disconnected`. */
  disconnect(sessionId: string): Promise<void>;
}

/**
 * The extension surface contributed by the React Native connections
 * package.
 *
 * @example
 * ```typescript
 * class WalletProvider extends Provider<typeof WalletProvider.EXTENSIONS> {
 *   static EXTENSIONS = [WithConnections] as const;
 *   connections!: ReactNativeConnectionsExtension["connections"];
 *   connection!: ReactNativeConnectionsExtension["connection"];
 * }
 * ```
 */
export interface ReactNativeConnectionsExtension {
  /** Reactive list of the connection sessions. */
  readonly connections: ConnectionSession[];
  /** The connection API (accept / resume / disconnect). */
  connection: ReactNativeConnectionApi;
}

/**
 * Wallet Provider Extension that adds the responder-role (wallet-side)
 * connections engine.
 *
 * The extension is a thin wrapper around the shared
 * {@link import("@algorandfoundation/connections-core").createConnectionsStore}
 * engine: it reads the `options.connections` block
 * ({@link ReactNativeConnectionsOptions}), defaults persistence to memory,
 * infers the connection domains from the provider surface per handshake and
 * routes `accept` / `resume` / `disconnect` through the protocol registry.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link ReactNativeConnectionsOptions}; every field is optional.
 *
 * @returns The {@link ReactNativeConnectionsExtension} surface: the reactive
 *   `connections` list and the `connection` API.
 *
 * @example
 * ```typescript
 * const WalletProvider = Provider.withExtensions([WithConnections]);
 * const provider = new WalletProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   {
 *     connections: {
 *       protocols: [
 *         liquidAuth({
 *           authSigner,
 *           wallet: { signTransactions, approveSignTransactions },
 *         }),
 *       ],
 *       driver: mmkvConnectionDriver,
 *     },
 *   },
 * );
 * await provider.connection.ready;
 * await provider.connection.accept(scannedLiquidUri);
 * // Later, when the transport dropped (session is `disconnected`):
 * await provider.connection.resume(sessionId);
 * ```
 */
export const WithConnections: Extension<ReactNativeConnectionsExtension> = (
  provider: Provider<any> & Partial<LogStoreExtension>,
  options: ReactNativeConnectionsOptions,
) => {
  const { api, store, protocols, ready } = createConnectionsStore({
    store: options?.connections?.store,
    hooks: options?.connections?.hooks,
    driver: options?.connections?.driver ?? memoryConnectionDriver(),
    storageKey: options?.connections?.storageKey,
    protocols: options?.connections?.protocols,
    log: provider.log,
  });

  /**
   * The wallet's domain registry, built lazily PER ACCESS: domains are
   * inferred from the provider surface at handshake time (unless an
   * explicit `options.connections.domains` list overrides the
   * inference), so the extension application order never matters;
   * `WithConnections` may well be applied before any store extension.
   * Protocol responders read it from `ProtocolContext.domains` to
   * answer the `connect` inventory exchange.
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

  // Responders are cached per protocol id (they may hold live state);
  // transports are runtime-only, keyed by session id.
  const responders = new Map<string, ConnectionResponder>();
  const transports = new Map<string, ConnectionTransport>();

  // In-flight resumes by session id, so concurrent calls share one attempt.
  const resumes = new Map<string, Promise<ConnectionSession>>();

  const getResponder = (protocolId: string): ConnectionResponder => {
    let responder = responders.get(protocolId);
    if (!responder) {
      responder = protocols.createResponder(protocolId, ctx);
      responders.set(protocolId, responder);
    }
    return responder;
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

  const track = (sessionId: string, transport: ConnectionTransport): void => {
    transports.set(sessionId, transport);
    transport.onStateChange((state) => {
      // Only untrack when this transport is still the session's current
      // one; a stale transport of a previous negotiation may close
      // after a resume already replaced it.
      if (state === "closed" && transports.get(sessionId) === transport) {
        transports.delete(sessionId);
      }
    });
  };

  const connection: ReactNativeConnectionApi = {
    store: api,
    protocols,
    ready,

    async accept(request: string, protocolId?: string): Promise<ConnectionSession> {
      const responder = getResponder(resolveProtocolId(protocolId));
      const { sessionId, transport } = await responder.accept(request);
      track(sessionId, transport);
      const session = await api.getSession(sessionId);
      if (!session) {
        throw new Error(`protocol accepted the request but tracked no session ${sessionId}`);
      }
      return session;
    },

    async resume(sessionId: string, protocolId?: string): Promise<ConnectionSession> {
      const inFlight = resumes.get(sessionId);
      if (inFlight) return inFlight;

      const attempt = (async (): Promise<ConnectionSession> => {
        const resolvedId = resolveProtocolId(protocolId);
        const responder = getResponder(resolvedId);
        const session = await api.getSession(sessionId);
        if (!session) {
          throw new Error(`no session ${sessionId} to resume`);
        }
        if (!responder.resume) {
          throw new Error(`protocol ${resolvedId} does not implement resume`);
        }
        const { transport } = await responder.resume(session);
        track(sessionId, transport);
        const refreshed = await api.getSession(sessionId);
        if (!refreshed) {
          throw new Error(`protocol resumed the connection but tracked no session ${sessionId}`);
        }
        return refreshed;
      })();

      resumes.set(sessionId, attempt);
      try {
        return await attempt;
      } finally {
        resumes.delete(sessionId);
      }
    },

    async disconnect(sessionId: string): Promise<void> {
      const transport = transports.get(sessionId);
      transports.delete(sessionId);
      transport?.close();
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
  } as ReactNativeConnectionsExtension;
};
