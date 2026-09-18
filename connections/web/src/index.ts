/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/connections-web` is the browser (dapp-side,
 * requester-role) entry point for the connections domain. It ships the
 * {@link WithConnections} Wallet Provider Extension, a thin wrapper around the
 * `createConnectionsStore` engine of `@algorandfoundation/connections-core`
 * that persists sessions to `localStorage`, infers the connection domains from
 * the provider surface and routes `connect` / `createRequest` / `resume`
 * through the protocols registered via `options.connections.protocols`. The
 * package augments the shared `options.connections` namespace with the dapp
 * `metadata` sent along the `connect` handshake. For standalone use it exports
 * {@link localStorageConnectionDriver}, the browser persistence driver, which
 * plugs straight into the core engine with no Provider involved.
 *
 * Most consumers should import the meta package `@algorandfoundation/connections`,
 * which resolves to this package via the `browser` export condition.
 */

export * from "./driver.ts";
export * from "./extension.ts";
