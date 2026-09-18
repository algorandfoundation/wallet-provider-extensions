/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/connections-liquid-auth` is the Liquid Auth connection
 * protocol as a {@link ConnectionProtocol} plug-in for the platform
 * `WithConnections` engines (and the standalone core engine): `liquid://` QR
 * requests, WebRTC signaling over `@algorandfoundation/liquid-client`, the
 * wallet-side WebAuthn attestation, and the wallet RPC over the negotiated
 * data channel. It reads nothing from `options.connections` itself: the
 * {@link liquidAuth} factory takes its own options and is registered through
 * the engines' `options.connections.protocols` list. Both roles implement the
 * optional `resume` seam for seamless reconnection: once a session has
 * paired, either party can rejoin the signaling room and renegotiate the
 * transport (the wallet re-sends its WebRTC offer, the dapp parks on the link
 * rendezvous) with no new QR scan and no new WebAuthn ceremony.
 *
 * @example
 * ```typescript
 * // Dapp side (requester)
 * const DappProvider = Provider.withExtensions([WithConnections]);
 * const dapp = new DappProvider(
 *   { id: "my-dapp", name: "My Dapp" },
 *   { connections: { protocols: [liquidAuth({ url: "https://liquid.example.com" })] } },
 * );
 *
 * // Wallet side (responder)
 * const WalletProvider = Provider.withExtensions([WithConnections]);
 * const wallet = new WalletProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   {
 *     connections: {
 *       protocols: [
 *         liquidAuth({
 *           authSigner: (challenge) => signer.signChallenge(challenge),
 *           wallet: { signTransactions },
 *         }),
 *       ],
 *     },
 *   },
 * );
 * ```
 */

import type {
  ConnectionProtocol,
  ConnectionRequester,
  ConnectionResponder,
  ProtocolContext,
} from "@algorandfoundation/connections-core";

import { createLiquidAuthRequester, type LiquidAuthRequesterOptions } from "./requester.ts";
import { createLiquidAuthResponder, type LiquidAuthResponderOptions } from "./responder.ts";

export * from "./address.ts";
export * from "./assertionOptions.ts";
export * from "./channel.ts";
export * from "./errors.ts";
export * from "./mock.ts";
export * from "./requester.ts";
export * from "./responder.ts";
export * from "./signaling.ts";
export * from "./uri.ts";

/**
 * The protocol id applications opt in by.
 *
 * @example
 * ```typescript
 * await provider.connection.connect(LIQUID_AUTH_PROTOCOL_ID);
 * ```
 */
export const LIQUID_AUTH_PROTOCOL_ID: string = "liquid-auth";

/**
 * Options accepted by {@link liquidAuth}: the union of both roles'
 * options. The requester role is available when `url` is set (the dapp
 * must know its signaling origin); the responder role is always
 * available (the origin arrives inside the `liquid://` URI).
 *
 * @example
 * ```typescript
 * const options: LiquidAuthProtocolOptions = {
 *   url: "https://liquid.example.com",
 *   wallet: { signTransactions },
 * };
 * ```
 */
export interface LiquidAuthProtocolOptions
  extends Omit<LiquidAuthRequesterOptions, "url">, LiquidAuthResponderOptions {
  /** The signaling server origin; required for the requester (dapp) role. */
  url?: string;
}

/**
 * Creates the Liquid Auth {@link ConnectionProtocol} plug-in.
 *
 * @param options - {@link LiquidAuthProtocolOptions}.
 * @returns The protocol, ready for an engine's `protocols: [...]` option.
 *
 * @example
 * ```typescript
 * const { api, protocols } = createConnectionsStore({
 *   protocols: [liquidAuth({ url: "https://liquid.example.com" })],
 * });
 * const requester = protocols.createRequester("liquid-auth", { sessions: api });
 * ```
 */
export function liquidAuth(options: LiquidAuthProtocolOptions = {}): ConnectionProtocol {
  const url = options.url;
  const protocol: ConnectionProtocol = {
    id: LIQUID_AUTH_PROTOCOL_ID,
    createResponder(ctx: ProtocolContext): ConnectionResponder {
      return createLiquidAuthResponder(options, ctx);
    },
  };
  if (url) {
    protocol.createRequester = (ctx: ProtocolContext): ConnectionRequester =>
      createLiquidAuthRequester({ ...options, url }, ctx);
  }
  return protocol;
}
