/**
 * The wallet-side (responding) half of the Liquid Auth protocol.
 *
 * `accept()` takes a scanned/pasted `liquid://` URI, authenticates
 * against the signaling service (liquid-auth attestation over the
 * host's WebAuthn implementation, with the wallet's ed25519
 * `authSigner` completing the liquid extension), sends the WebRTC
 * offer, and answers the wallet RPC over the negotiated channel via
 * `createWalletResponder`.
 *
 * `resume()` renegotiates an already-paired session: the wallet rejoins
 * the session's `requestId` room and re-sends its offer to the peer
 * parked on the link rendezvous. The same `authenticate` step runs;
 * hosts whose signaling session is still authenticated skip the
 * ceremony there; the package stays agnostic.
 */

import {
  ConnectionRpcError,
  createConnectionRpc,
  createSecureMessaging,
  createWalletResponder,
  type ConnectApprovalContext,
  type ConnectParams,
  type ConnectionMessage,
  type ConnectionResponder,
  type ConnectionRpc,
  type ConnectionSession,
  type ConnectionTransport,
  type CreateWalletResponderOptions,
  type EstablishedConnection,
  type ProtocolContext,
  type SecureChannel,
  type SecureMessaging,
} from "@algorandfoundation/connections-core";

import { toAlgorandAddress } from "./address.ts";
import { fetchAssertionOptions } from "./assertionOptions.ts";
import type { LiquidAssertionOptions } from "./assertionOptions.ts";
import { dataChannelTransport } from "./channel.ts";
import { LiquidAuthError } from "./errors.ts";
import {
  defaultSignalClientFactory,
  type LiquidAuthSignature,
  type LiquidDataChannel,
  type LiquidSignalClient,
  type LiquidSignalClientFactory,
} from "./signaling.ts";
import { buildLiquidUri, parseLiquidUri, type LiquidUri } from "./uri.ts";

/**
 * Capabilities the responder hands to an
 * {@link LiquidAuthResponderOptions.authenticate} override, so custom
 * authentication flows can obtain (and broadcast) the server's WebAuthn
 * request options without re-implementing the HTTP exchange.
 *
 * @example
 * ```typescript
 * authenticate: async (client, uri, helpers) => {
 *   const options = await helpers!.fetchAssertionOptions(credentialId);
 *   await nativeAssert(client, options);
 *   client.authenticated = true;
 * }
 * ```
 */
export interface LiquidAuthenticateHelpers {
  /**
   * Fetches the WebAuthn assertion request options for a credential id
   * from the session's signaling origin; every result is also forwarded
   * to {@link LiquidAuthResponderOptions.onAssertionOptions}.
   */
  fetchAssertionOptions(credentialId: string): Promise<LiquidAssertionOptions>;
  /** The host's {@link LiquidAuthResponderOptions.onAssertionOptions} seam, when configured. */
  onAssertionOptions?: (options: LiquidAssertionOptions) => void;
}

/**
 * The peer context the {@link LiquidMessagingOptions.channel} factory
 * derives a session's secure channel from: which session the transport
 * serves and the domain records the dapp introduced in its `connect`
 * params (the `identities` records' DID documents carry the
 * `keyAgreement` keys).
 *
 * @example
 * ```typescript
 * channel: (peer: LiquidMessagingPeer) => {
 *   const [identity] = (peer.domains.identities ?? []) as IdentityRecord[];
 *   const remote = identity && keyAgreementPublicKey(identity.didDocument);
 *   return remote ? createSecureChannel({ privateKey, remotePublicKey: remote }) : null;
 * }
 * ```
 */
export interface LiquidMessagingPeer {
  /** The id of the session the channel belongs to (the requestId). */
  sessionId: string;
  /** The signaling origin of the session. */
  origin: string;
  /**
   * The records the dapp introduced with its `connect` request, keyed
   * by domain id. Hosts typically read `domains.identities` and derive
   * the channel via `keyAgreementPublicKey`.
   */
  domains: Record<string, unknown[]>;
  /** Whether the handshake renegotiated an already-approved pairing. */
  resumed: boolean;
}

/**
 * Actions handed to {@link LiquidMessagingOptions.onMessage} alongside
 * each decrypted incoming message.
 *
 * @example
 * ```typescript
 * onMessage: (message, actions) => showAlert(message.text, () => actions.acknowledge()),
 * ```
 */
export interface LiquidMessageActions {
  /**
   * Explicitly acknowledges the message: sends `message_ack` back to
   * the sender and marks the local copy `acknowledged`. The seam for
   * hosts that gate the ack on the user (set `autoAcknowledge: false`
   * and call this from the user prompt).
   */
  acknowledge(): Promise<ConnectionMessage | undefined>;
}

/**
 * The secure-messaging seam of the responder.
 *
 * When configured, every approved `connect` handshake is followed by a
 * {@link LiquidMessagingOptions.channel} call with the dapp's announced
 * domains; a returned channel composes `createSecureMessaging` with the
 * wallet responder on the transport's rpc, so `message`/`message_ack`
 * requests are answered (and persisted through the engine's store)
 * alongside `connect`/`sign_transactions`.
 *
 * @remarks
 * INFORMAL contract; a proper messaging spec will come later and replace
 * it.
 *
 * @example
 * ```typescript
 * liquidAuth({
 *   wallet: { signTransactions },
 *   messaging: {
 *     channel: (peer) => deriveChannel(peer.domains.identities),
 *     onMessage: (message, actions) => alertUser(message, actions.acknowledge),
 *     autoAcknowledge: false,
 *   },
 * });
 * ```
 */
export interface LiquidMessagingOptions {
  /**
   * Derives the session's {@link SecureChannel} from the domain records
   * the dapp introduced (`peer.domains.identities`), typically X25519
   * ECDH between the wallet's own identity key and the dapp's
   * `keyAgreement` key (see `keyAgreementPublicKey` /
   * `createSecureChannel` of `@algorandfoundation/connections-core`).
   * Return `null`/`undefined` when no usable key is present: messaging
   * then stays off and `message` requests are rejected with
   * `secure_channel_unavailable`.
   */
  channel(
    peer: LiquidMessagingPeer,
  ): SecureChannel | null | undefined | Promise<SecureChannel | null | undefined>;
  /**
   * Invoked with every decrypted incoming message (the wallet's seam
   * for alerting the user), plus the {@link LiquidMessageActions} to
   * acknowledge it.
   */
  onMessage?(message: ConnectionMessage, actions: LiquidMessageActions): void;
  /**
   * Whether incoming messages are acknowledged automatically (default
   * `true`). Turn off to gate the ack on the user instead and call
   * {@link LiquidMessageActions.acknowledge} from the prompt.
   */
  autoAcknowledge?: boolean;
}

/**
 * Options of the Liquid Auth responder (wallet side).
 *
 * @example
 * ```typescript
 * const options: LiquidAuthResponderOptions = {
 *   authSigner: (challenge) => wallet.signChallenge(challenge),
 *   wallet: { signTransactions, approveConnect: (params) => promptUser(params) },
 * };
 * ```
 */
export interface LiquidAuthResponderOptions {
  /** Signal client factory override (defaults to `SignalClient` of liquid-client). */
  createSignalClient?: LiquidSignalClientFactory;
  /**
   * Signs the liquid-auth service challenge with the wallet's ed25519
   * key, completing the liquid extension of the attestation. Required
   * unless {@link LiquidAuthResponderOptions.authenticate} overrides the
   * whole authentication step. The returned `address` may be either a
   * canonical Algorand address or a base64 public key; the responder
   * normalizes it via {@link toAlgorandAddress} before it goes on the
   * wire.
   */
  authSigner?(
    challenge: Uint8Array,
    context: { origin: string; requestId: string },
  ): Promise<LiquidAuthSignature>;
  /**
   * Full override of the authentication step (e.g. a host that already
   * authenticated out-of-band and only needs `client.authenticated`
   * set). The default runs liquid-auth attestation over the host's
   * WebAuthn implementation.
   */
  authenticate?(
    client: LiquidSignalClient,
    uri: LiquidUri,
    helpers?: LiquidAuthenticateHelpers,
  ): Promise<void>;
  /**
   * Invoked whenever the responder obtains WebAuthn request options
   * from the signaling service (via the
   * {@link LiquidAuthenticateHelpers.fetchAssertionOptions} helper), so
   * hosts can reconcile a local passkey store (see
   * `@algorandfoundation/passkeys-core`).
   */
  onAssertionOptions?: (options: LiquidAssertionOptions) => void;
  /**
   * Wallet seams answering the connection RPC (`connect`,
   * `sign_transactions`). When provided, the responder attaches
   * `createWalletResponder` over every established transport. The
   * connection domains are NOT configured here: the responder answers
   * the `connect` inventory exchange from the hosting engine's registry
   * (`ProtocolContext.domains`, inferred from the provider surface) and
   * scopes it to the session it serves.
   */
  wallet?: Omit<CreateWalletResponderOptions, "domains" | "sessionId">;
  /**
   * Secure-messaging seam composed with the wallet responder (requires
   * {@link LiquidAuthResponderOptions.wallet}). See
   * {@link LiquidMessagingOptions}.
   */
  messaging?: LiquidMessagingOptions;
  /** `RTCConfiguration` override forwarded to the peer negotiation. */
  rtcConfiguration?: unknown;
  /** Data channel labels/configs to negotiate (defaults to `{ liquid: {} }`). */
  dataChannels?: Record<string, unknown>;
}

/** Whether the host exposes a WebAuthn `credentials.create` surface. */
function hasWebAuthn(): boolean {
  const container = (globalThis.navigator as { credentials?: unknown } | undefined)?.credentials;
  return !!container && typeof (container as { create?: unknown }).create === "function";
}

/**
 * Creates the Liquid Auth {@link ConnectionResponder}.
 *
 * @param options - {@link LiquidAuthResponderOptions}.
 * @param ctx - The hosting engine's {@link ProtocolContext}.
 * @returns The responder.
 *
 * @example
 * ```typescript
 * const responder = createLiquidAuthResponder(
 *   { authSigner, wallet: { signTransactions } },
 *   { sessions: api },
 * );
 * const { sessionId, transport } = await responder.accept(scannedLiquidUri);
 * ```
 */
export function createLiquidAuthResponder(
  options: LiquidAuthResponderOptions,
  ctx: ProtocolContext,
): ConnectionResponder {
  const createClient = options.createSignalClient ?? defaultSignalClientFactory;

  // The CURRENT transport per session id, plus the sessions with a
  // renegotiation in flight: a stale transport of a previous negotiation
  // may close after a re-accept/resume already replaced it (or while the
  // replacement is still negotiating); its close must not clobber the
  // session's status.
  const currentTransports = new Map<string, ConnectionTransport>();
  const renegotiating = new Set<string>();

  /**
   * Wraps the wallet seams so `approveConnect` receives the
   * {@link ConnectApprovalContext} of the transport it answers on: a
   * resumed pairing's `connect` handshake can then auto-approve instead
   * of re-prompting the user.
   */
  const walletOptionsFor = (
    wallet: Omit<CreateWalletResponderOptions, "domains" | "sessionId">,
    context: ConnectApprovalContext,
  ): CreateWalletResponderOptions => {
    const approveConnect = wallet.approveConnect?.bind(wallet);
    // The engine's registry answers the inventory exchange, scoped to
    // the session this responder serves.
    const options: CreateWalletResponderOptions = {
      ...wallet,
      domains: ctx.domains,
      sessionId: context.sessionId,
    };
    if (!approveConnect) return options;
    return {
      ...options,
      approveConnect: (params) => approveConnect(params, context),
    };
  };

  /** Builds the {@link LiquidAuthenticateHelpers} bound to a request's signaling origin. */
  const makeHelpers = (uri: LiquidUri): LiquidAuthenticateHelpers => ({
    fetchAssertionOptions: async (credentialId: string): Promise<LiquidAssertionOptions> => {
      const assertionOptions = await fetchAssertionOptions({ url: uri.origin, credentialId });
      options.onAssertionOptions?.(assertionOptions);
      return assertionOptions;
    },
    onAssertionOptions: options.onAssertionOptions,
  });

  const authenticate = async (client: LiquidSignalClient, uri: LiquidUri): Promise<void> => {
    if (options.authenticate) {
      await options.authenticate(client, uri, makeHelpers(uri));
      return;
    }
    if (!hasWebAuthn()) {
      throw new LiquidAuthError(
        "webauthn_unavailable",
        "no WebAuthn implementation (navigator.credentials.create) is available on this host; " +
          "install a polyfill or inject an `authenticate` override",
      );
    }
    const authSigner = options.authSigner;
    if (!authSigner) {
      throw new LiquidAuthError(
        "auth_signer_missing",
        "an `authSigner` is required to complete the liquid extension of the attestation",
      );
    }
    await client.attestation(async (challenge: Uint8Array) => {
      const signature = await authSigner(challenge, uri);
      return {
        type: "algorand",
        requestId: uri.requestId,
        origin: uri.origin,
        ...signature,
        // The service decodes the address to verify the ed25519 signature;
        // tolerate hosts that key accounts by raw/base64 public keys.
        address: toAlgorandAddress(signature.address),
      };
    });
  };

  /**
   * Records the dapp's announced domains (and display metadata) on the
   * wallet-side session after an APPROVED `connect`; the persisted
   * `peer.domains` keys are the peer's supported-domain announcement.
   */
  const recordPeer = async (sessionId: string, params: ConnectParams): Promise<void> => {
    try {
      const existing = await ctx.sessions.getSession(sessionId);
      if (!existing) return;
      await ctx.sessions.upsertSession({
        ...existing,
        peer: {
          domains: params.domains ?? {},
          ...(params.metadata?.name ? { metadata: { name: params.metadata.name } } : {}),
        },
        updatedAt: Date.now(),
      });
    } catch (e) {
      ctx.log?.warn(
        `failed to record the peer's domains for session ${sessionId}: ${String(e)}`,
        {},
        "LiquidAuthResponder",
      );
    }
  };

  /**
   * Attaches the request handler of a transport's rpc: the wallet
   * responder, composed (when the {@link LiquidMessagingOptions} seam
   * is configured) with the secure-messaging layer. The messaging
   * layer only comes alive after an APPROVED `connect` whose announced
   * domains the host derived a channel from; until then,
   * `message`/`message_ack` reject with `secure_channel_unavailable`.
   */
  const attachHandler = (
    rpc: ConnectionRpc,
    wallet: Omit<CreateWalletResponderOptions, "domains" | "sessionId">,
    session: { id: string; origin: string },
    resumed: boolean,
  ): void => {
    const responder = createWalletResponder(
      walletOptionsFor(wallet, { sessionId: session.id, resumed }),
    );
    const messagingOptions = options.messaging;
    let messaging: SecureMessaging | undefined;
    rpc.onRequest(async (method, params) => {
      if (method === "message" || method === "message_ack") {
        if (!messaging) {
          throw new ConnectionRpcError(
            "secure_channel_unavailable",
            "no secure channel was derived for this session",
          );
        }
        return messaging.handle(method, params);
      }
      const result = await responder.handle(method, params);
      if (method === "connect") {
        const connectParams = (params ?? {}) as ConnectParams;
        // The connect was APPROVED: persist which domains the dapp
        // announced (and shared) on the session.
        await recordPeer(session.id, connectParams);
        if (messagingOptions && !messaging) {
          // Derive the session's channel from the announced domains
          // (typically `domains.identities`). Failures here must not
          // fail the handshake; messaging simply stays off.
          try {
            const channel = await messagingOptions.channel({
              sessionId: session.id,
              origin: session.origin,
              domains: connectParams.domains ?? {},
              resumed,
            });
            if (channel) {
              const secure: SecureMessaging = createSecureMessaging({
                rpc,
                channel,
                sessionId: session.id,
                messages: ctx.sessions,
                autoAcknowledge: messagingOptions.autoAcknowledge,
                onMessage: messagingOptions.onMessage
                  ? (message) =>
                      messagingOptions.onMessage!(message, {
                        acknowledge: () => secure.acknowledge(message.id),
                      })
                  : undefined,
              });
              messaging = secure;
            }
          } catch (e) {
            ctx.log?.warn(
              `secure channel derivation failed for session ${session.id}: ${String(e)}`,
              {},
              "LiquidAuthResponder",
            );
          }
        }
      }
      return result;
    });
  };

  /** Wraps an established channel: transport + wallet RPC + session wiring. */
  const bind = async (
    channel: LiquidDataChannel,
    session: { id: string; origin: string },
    resumed: boolean,
  ): Promise<ConnectionTransport> => {
    const transport = dataChannelTransport(channel);
    currentTransports.set(session.id, transport);
    if (options.wallet) {
      attachHandler(createConnectionRpc(transport), options.wallet, session, resumed);
    }
    transport.onStateChange((state) => {
      if (state !== "closed") return;
      // Only the session's CURRENT transport (outside a renegotiation)
      // moves it to `disconnected`; stale closes are bookkeeping noise.
      if (currentTransports.get(session.id) !== transport || renegotiating.has(session.id)) {
        return;
      }
      currentTransports.delete(session.id);
      void ctx.sessions.updateSessionStatus(session.id, "disconnected");
    });
    const now = Date.now();
    // Keep the original creation timestamp across re-accepts/resumes:
    // a renegotiated transport is still the same session.
    const existing = await ctx.sessions.getSession(session.id);
    await ctx.sessions.upsertSession({
      id: session.id,
      origin: session.origin,
      status: "connected",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return transport;
  };

  /**
   * The shared tail of `accept()` and `resume()`: authenticate against
   * the signaling service, send the WebRTC offer, and bind the answered
   * channel, wiring the session status transitions along the way.
   */
  const pair = async (
    client: LiquidSignalClient,
    uri: LiquidUri,
    resumed: boolean,
  ): Promise<EstablishedConnection> => {
    renegotiating.add(uri.requestId);
    try {
      await authenticate(client, uri);
      await ctx.sessions.updateSessionStatus(uri.requestId, "connecting");
      // The wallet SENDS the offer and waits for the dapp's answer.
      const channel = await client.peer(
        uri.requestId,
        "answer",
        options.rtcConfiguration,
        options.dataChannels ? { dataChannels: options.dataChannels } : undefined,
      );
      const transport = await bind(channel, { id: uri.requestId, origin: uri.origin }, resumed);
      return { sessionId: uri.requestId, transport };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.sessions.updateSessionStatus(uri.requestId, "failed", message);
      client.close(true);
      throw e;
    } finally {
      renegotiating.delete(uri.requestId);
    }
  };

  const accept = async (request: string): Promise<EstablishedConnection> => {
    const uri = parseLiquidUri(request);
    const client = createClient(uri.origin);
    const now = Date.now();
    // Re-accepting a known requestId renegotiates the SAME session;
    // keep its original creation time instead of minting a new record.
    const existing = await ctx.sessions.getSession(uri.requestId);
    await ctx.sessions.upsertSession({
      id: uri.requestId,
      origin: uri.origin,
      status: "authenticating",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return pair(client, uri, false);
  };

  const resume = async (session: ConnectionSession): Promise<EstablishedConnection> => {
    if (!session?.id || !session?.origin) {
      throw new LiquidAuthError(
        "invalid_session",
        "a session with an `id` and `origin` is required to resume",
      );
    }
    // Reconstruct the liquid:// URI the session was accepted from; the
    // round-trip normalizes the origin exactly like a scanned request.
    const uri = parseLiquidUri(buildLiquidUri(session.origin, session.id));
    // A SignalClient is single-shot; every resume gets a fresh one.
    const client = createClient(uri.origin);
    await ctx.sessions.upsertSession({
      ...session,
      status: "authenticating",
      updatedAt: Date.now(),
    });
    return pair(client, uri, true);
  };

  return { accept, resume };
}
