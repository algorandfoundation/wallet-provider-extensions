/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities-connections-extension` bridges the identity
 * store (`@algorandfoundation/identities-core`) and the connections domain
 * seam. The {@link WithIdentitiesConnections} extension mounts the store's
 * session-scoped **remote mirror** (`{ expose, receive, revoke }`) at
 * `provider.identity.remote`, the surface connection engines duck-type to
 * exchange `IdentityRecord`s over a session, reading the shared store from
 * `options.identities.store`. The mirror itself
 * ({@link remoteIdentitiesMirror}) is pure store code and runs standalone
 * over any `Store<IdentityStoreState>`, no Provider required.
 */

export * from "./extension.ts";
export * from "./remote.ts";
