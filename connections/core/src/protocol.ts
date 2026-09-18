/**
 * The **protocol plug-in contract** of the connections domain.
 *
 * Platform engines (`connections-web`, `react-native-connections`) host
 * connection protocols (Liquid Auth first, WalletConnect / Matrix / ...
 * as future sibling packages) through this seam: a protocol package
 * exports a {@link ConnectionProtocol} (an id plus requester/responder
 * factories), applications register the protocols they opt into via the
 * engines' `protocols: [...]` option, and every protocol converges on
 * the same {@link import("./types.ts").ConnectionTransport} +
 * `ConnectionRpc` wire contract of this package.
 */

import type { LogStoreApi } from "@algorandfoundation/logs";

import type { ConnectionDomainRegistry } from "./domains.ts";
import type { ConnectionSession, ConnectionTransport, ConnectionsStoreApi } from "./types.ts";

/**
 * The engine-owned context handed to a protocol's requester/responder
 * factories.
 *
 * Protocols use it to read/update the sessions the engine tracks and to
 * log through the application's logger. Platform engines may extend it
 * structurally (extra fields are invisible to protocols that do not
 * know them).
 *
 * @example
 * ```typescript
 * const ctx: ProtocolContext = { sessions: api, log: provider.log };
 * const requester = protocol.createRequester!(ctx);
 * ```
 */
export interface ProtocolContext {
  /** The session CRUD API of the hosting engine's connections store. */
  sessions: ConnectionsStoreApi;
  /**
   * The domain registry of the hosting engine: the connection domains
   * discovered from the provider surface (or registered explicitly), so
   * protocol responders answer the `connect` inventory exchange from it
   * instead of carrying wallet seams of their own.
   */
  domains?: ConnectionDomainRegistry;
  /** Optional logger (typically `provider.log`). */
  log?: LogStoreApi;
}

/**
 * A pending connection request created by a {@link ConnectionRequester}.
 *
 * Carries everything the application needs to surface the out-of-band
 * path (`uri`/`qrData` for a QR code) while `establish()` waits for the
 * remote peer to answer, whichever way the request reached it.
 *
 * @example
 * ```typescript
 * const request = await requester.createRequest();
 * renderQr(request.qrData);
 * const transport = await request.establish();
 * ```
 */
export interface ConnectionRequest {
  /** Protocol-scoped request identifier (e.g. the liquid-auth `requestId`). */
  id: string;
  /** Deep-linkable request URI (e.g. `liquid://...`), when the protocol has one. */
  uri?: string;
  /** Payload to render as a QR code; usually the {@link ConnectionRequest.uri}. */
  qrData?: string;
  /**
   * Waits for the remote peer and resolves with the established
   * transport. Rejects when the wait is aborted or the protocol's
   * establishment fails.
   */
  establish(opts?: { signal?: AbortSignal }): Promise<ConnectionTransport>;
}

/**
 * An established connection: the live transport plus the id of the
 * session the protocol tracked for it. This is how hosting engines correlate
 * role-method results with the session store.
 *
 * @example
 * ```typescript
 * const { sessionId, transport } = await responder.accept(scannedUri);
 * ```
 */
export interface EstablishedConnection {
  /** The id of the {@link import("./types.ts").ConnectionSession} backing this connection. */
  sessionId: string;
  /** The live transport of the connection. */
  transport: ConnectionTransport;
}

/**
 * Options accepted by {@link ConnectionRequester.connect}.
 *
 * @example
 * ```typescript
 * await provider.connection.connect("liquid-auth", {
 *   onFallback: (request) => renderQr(request.qrData),
 * });
 * ```
 */
export interface ConnectOptions {
  /** Aborts the connection attempt. */
  signal?: AbortSignal;
  /**
   * Invoked when the protocol falls back to its out-of-band path (e.g.
   * QR) so the application can render the request while `connect()`
   * keeps waiting for the peer.
   */
  onFallback?(request: ConnectionRequest): void;
}

/**
 * Options accepted by the optional `resume` methods of the two roles.
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * await requester.resume!(session, { signal: controller.signal });
 * ```
 */
export interface ResumeOptions {
  /** Aborts the resume attempt. */
  signal?: AbortSignal;
}

/**
 * The dapp-side (requesting) half of a protocol.
 *
 * @example
 * ```typescript
 * const requester = registry.createRequester("liquid-auth", ctx);
 * const request = await requester.createRequest();
 * ```
 */
export interface ConnectionRequester {
  /**
   * Creates a pending connection request the application drives itself
   * (typically: render the QR, then `establish()`).
   */
  createRequest(): Promise<ConnectionRequest>;
  /**
   * The protocol's preferred one-shot establishment path when it has
   * one, with automatic fallback to the out-of-band request (surfaced
   * via {@link ConnectOptions.onFallback}). Optional; engines fall
   * back to {@link ConnectionRequester.createRequest} + `establish()`
   * when absent.
   */
  connect?(opts?: ConnectOptions): Promise<EstablishedConnection>;
  /**
   * Renegotiates an ALREADY-PAIRED session over the protocol's
   * signaling service: no new out-of-band request is created; the
   * requester rejoins the session's rendezvous (e.g. the liquid-auth
   * requestId room) and waits for the responding peer to renegotiate
   * the transport. Optional; only protocols whose signaling service
   * supports reconnection implement it.
   */
  resume?(session: ConnectionSession, opts?: ResumeOptions): Promise<ConnectionTransport>;
}

/**
 * The wallet-side (responding) half of a protocol.
 *
 * @example
 * ```typescript
 * const responder = registry.createResponder("liquid-auth", ctx);
 * const { sessionId } = await responder.accept(scannedUri);
 * ```
 */
export interface ConnectionResponder {
  /**
   * Accepts an inbound connection request (a scanned/pasted URI or a
   * protocol-specific payload) and resolves with the established
   * connection.
   */
  accept(request: string): Promise<EstablishedConnection>;
  /**
   * Renegotiates an ALREADY-PAIRED session over the protocol's
   * signaling service: rejoins the session's rendezvous and initiates a
   * fresh transport negotiation with the waiting peer, reusing the
   * still-valid signaling authentication when the protocol has one
   * (e.g. the liquid-auth service session) instead of repeating the
   * full authentication ceremony. Optional; only protocols whose
   * signaling service supports reconnection implement it.
   */
  resume?(session: ConnectionSession, opts?: ResumeOptions): Promise<EstablishedConnection>;
}

/**
 * A connection protocol plug-in.
 *
 * Protocol packages export a factory returning this shape (e.g.
 * `liquidAuth(options)`); either role factory may be omitted when the
 * package only implements one side.
 *
 * @example
 * ```typescript
 * const echo: ConnectionProtocol = {
 *   id: "echo",
 *   createResponder: (ctx) => ({ accept: (request) => establishEcho(ctx, request) }),
 * };
 * ```
 */
export interface ConnectionProtocol {
  /** Stable protocol identifier applications opt in by (e.g. `"liquid-auth"`). */
  id: string;
  /** Builds the dapp-side requester for this protocol. */
  createRequester?(ctx: ProtocolContext): ConnectionRequester;
  /** Builds the wallet-side responder for this protocol. */
  createResponder?(ctx: ProtocolContext): ConnectionResponder;
}

/**
 * Error raised when a protocol id is not registered with the hosting
 * engine (or is registered without the requested role factory).
 *
 * @example
 * ```typescript
 * try {
 *   await provider.connection.connect("walletconnect");
 * } catch (e) {
 *   if (e instanceof UnknownProtocolError) console.warn(e.protocolId, e.code);
 * }
 * ```
 */
export class UnknownProtocolError extends Error {
  /** Stable machine-readable code: `unknown_protocol`. */
  code: string;
  /** The protocol id that failed to resolve. */
  protocolId: string;

  constructor(protocolId: string, message?: string) {
    super(message ?? `unknown connection protocol: ${protocolId}`);
    this.name = "UnknownProtocolError";
    this.code = "unknown_protocol";
    this.protocolId = protocolId;
  }
}

/**
 * The protocol lookup surface platform engines route `connect(protocolId)`
 * / `accept(protocolId, ...)` calls through.
 *
 * @example
 * ```typescript
 * if (provider.connection.protocols.has("liquid-auth")) {
 *   await provider.connection.connect("liquid-auth");
 * }
 * ```
 */
export interface ProtocolRegistry {
  /** The ids of every registered protocol, in registration order. */
  ids(): string[];
  /** Whether a protocol is registered under the given id. */
  has(id: string): boolean;
  /**
   * Resolves a protocol by id.
   *
   * @throws {@link UnknownProtocolError} when the id is not registered.
   */
  get(id: string): ConnectionProtocol;
  /**
   * Builds the requester of the protocol registered under `id`.
   *
   * @throws {@link UnknownProtocolError} when the id is not registered
   * or the protocol has no requester factory.
   */
  createRequester(id: string, ctx: ProtocolContext): ConnectionRequester;
  /**
   * Builds the responder of the protocol registered under `id`.
   *
   * @throws {@link UnknownProtocolError} when the id is not registered
   * or the protocol has no responder factory.
   */
  createResponder(id: string, ctx: ProtocolContext): ConnectionResponder;
}

/**
 * Creates a {@link ProtocolRegistry} from the protocols an application
 * registered with its engine.
 *
 * Later registrations win on duplicate ids, so applications can
 * override a default protocol wholesale.
 *
 * @param protocols - The registered {@link ConnectionProtocol}s.
 * @returns The {@link ProtocolRegistry}.
 *
 * @example
 * ```typescript
 * const registry = createProtocolRegistry([liquidAuth({ url })]);
 * const requester = registry.createRequester("liquid-auth", { sessions });
 * ```
 */
export function createProtocolRegistry(protocols: ConnectionProtocol[] = []): ProtocolRegistry {
  const byId = new Map<string, ConnectionProtocol>();
  for (const protocol of protocols) {
    byId.set(protocol.id, protocol);
  }

  const get = (id: string): ConnectionProtocol => {
    const protocol = byId.get(id);
    if (!protocol) {
      throw new UnknownProtocolError(id);
    }
    return protocol;
  };

  return {
    ids(): string[] {
      return [...byId.keys()];
    },
    has(id: string): boolean {
      return byId.has(id);
    },
    get,
    createRequester(id: string, ctx: ProtocolContext): ConnectionRequester {
      const protocol = get(id);
      if (!protocol.createRequester) {
        throw new UnknownProtocolError(id, `protocol ${id} does not implement the requester role`);
      }
      return protocol.createRequester(ctx);
    },
    createResponder(id: string, ctx: ProtocolContext): ConnectionResponder {
      const protocol = get(id);
      if (!protocol.createResponder) {
        throw new UnknownProtocolError(id, `protocol ${id} does not implement the responder role`);
      }
      return protocol.createResponder(ctx);
    },
  };
}
