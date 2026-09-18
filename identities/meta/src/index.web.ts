/**
 * @module default
 * @packageDocumentation
 *
 * Browser condition entry for `@algorandfoundation/identities`, resolved via
 * the `browser` export condition. It exports the composed
 * {@link WithIdentities} extension (core store plus the lazily loaded
 * keystore and connections bridges) for Wallet Providers, and re-exports the
 * core store functions, DID helpers and types for standalone use. Currently
 * identical to the platform-neutral composition; a browser identities package
 * will replace this delegation when a real platform seam lands.
 */

export * from "@algorandfoundation/identities-core";
export { WithIdentities } from "./extension.ts";
export type { IdentitiesExtension, IdentitiesExtensionOptions } from "./types.ts";
export type {
  IdentitiesConnectionsExtension,
  IdentitiesConnectionsOptions,
  RemoteIdentitiesMirror,
} from "@algorandfoundation/identities-connections-extension";
export type {
  IdentitiesKeystoreExtension,
  IdentitiesKeystoreExtensionOptions,
  IdentitiesKeystoreNamespace,
} from "@algorandfoundation/identities-keystore-extension";
