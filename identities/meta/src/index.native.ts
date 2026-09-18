/**
 * @module default
 * @packageDocumentation
 *
 * React Native condition entry for `@algorandfoundation/identities`,
 * resolved via the `react-native` export condition (honored by Metro).
 * It exports the composed {@link WithIdentities} extension (core store plus
 * the lazily loaded keystore and connections bridges) for Wallet Providers,
 * and re-exports the core store functions, DID helpers and types for
 * standalone use. Currently identical to the platform-neutral composition;
 * a React Native identities package will replace this delegation when a real
 * platform seam lands.
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
