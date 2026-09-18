/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/react-native-connections` is the React Native
 * (wallet-side, responder-role) entry point for the connections domain. It
 * ships the {@link WithConnections} Wallet Provider Extension, a thin wrapper
 * around the `createConnectionsStore` engine of
 * `@algorandfoundation/connections-core` that infers the connection domains
 * from the provider surface and routes `accept` / `resume` / `disconnect`
 * through the protocols registered via `options.connections.protocols`. The
 * engine reads only the platform-neutral `options.connections` fields; inject
 * a durable driver (e.g. an MMKV wrapper) to persist sessions across restarts.
 * The extension is the package's only runtime surface, so the standalone path
 * runs on the core engine directly.
 *
 * Most consumers should import the meta package `@algorandfoundation/connections`,
 * which resolves to this package via the `react-native` export condition.
 */

export * from "./extension.ts";
