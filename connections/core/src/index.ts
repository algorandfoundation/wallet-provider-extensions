/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/connections-core` holds the platform-neutral surface of
 * the connections domain: the session/message store engine
 * ({@link createConnectionsStore}), the {@link ConnectionTransport} contract,
 * the versioned wallet RPC ({@link createConnectionRpc}, `connect` /
 * `sign_transactions` / `message` / `message_ack`), the wallet-side
 * {@link createWalletResponder}, the identity-key secure channel and
 * messaging layer, the generic connection-domain seam
 * ({@link discoverDomains}) and the {@link ConnectionProtocol} plug-in
 * contract. It also registers the `options.connections` namespace
 * ({@link ConnectionsNamespace}) on the shared `ExtensionOptions` registry,
 * which the platform packages augment with their extras. The package carries
 * zero protocol and zero platform code: the platform engines
 * (`@algorandfoundation/connections-web`,
 * `@algorandfoundation/react-native-connections`) and the protocol plug-ins
 * (`@algorandfoundation/connections-liquid-auth`) build on it, and every
 * primitive runs standalone without a Provider.
 *
 * Most consumers should import the meta package `@algorandfoundation/connections`,
 * which re-exports this package from every condition and resolves to the
 * correct platform engine via package export conditions.
 */

export * from "./crypto.ts";
export * from "./domains.ts";
export * from "./engine.ts";
export * from "./errors.ts";
export * from "./messaging.ts";
export * from "./protocol.ts";
export * from "./responder.ts";
export * from "./rpc.ts";
export * from "./store.ts";
export * from "./transport.ts";
export * from "./types.ts";
