/**
 * @module default
 * @packageDocumentation
 *
 * Browser condition entry for `@algorandfoundation/connections`. Resolved via
 * the `browser` export condition, it re-exports the platform-neutral core
 * primitives and the bundled default protocols (Liquid Auth), plus the
 * requester-role `WithConnections` engine of
 * `@algorandfoundation/connections-web`, so a dapp mounts the domain with one
 * import. The `options.connections` block is the core `ConnectionsNamespace`
 * augmented with the browser package's dapp `metadata`.
 */

export * from "@algorandfoundation/connections-core";
export * from "@algorandfoundation/connections-liquid-auth";
export * from "@algorandfoundation/connections-web";
