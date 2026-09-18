/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities` is the **meta package** for the
 * identities domain. Its `package.json` `exports` map uses runtime/bundler
 * conditions (`react-native` / `browser` / `node`), mirroring
 * `@algorandfoundation/keystore`, `@algorandfoundation/accounts`, and
 * `@algorandfoundation/credentials`.
 *
 * Unlike the thinner metas, this package **owns** the composed
 * {@link WithIdentities} extension: it mounts the core store
 * (`@algorandfoundation/identities-core`, whose own `WithIdentities` is store
 * only and is shadowed here) together with the keystore bridge
 * (`@algorandfoundation/identities-keystore-extension`, loaded lazily when
 * the provider carries a keystore) and the connections bridge
 * (`@algorandfoundation/identities-connections-extension`, loaded lazily to
 * mount `provider.identity.remote`). Everything else core exports (pure
 * store functions, DID helpers, types) is re-exported, so the domain also
 * runs standalone from this one install.
 *
 * Today every condition resolves to the same platform-neutral composition.
 * Per-platform identities packages (e.g. an mDoc-backed identity source via
 * the Digital Credentials API) will slot into the corresponding conditions
 * later without any application-facing change.
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
