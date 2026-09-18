/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials-connections-extension` bridges the
 * credentials domain and the connections domain seam. Its pure store helper
 * {@link remoteCredentialsMirror} mirrors a remote peer's credential
 * **presentation metadata** ({@link CredentialRecord}: no raw payload, no
 * claims) into the same reactive store the local credentials live in, tagged
 * per session and evicted when the session ends. The
 * {@link WithCredentialsConnections} extension mounts that mirror at
 * `provider.credential.remote`, the `{ expose, receive, revoke }` surface the
 * connections engines duck-type to exchange credential metadata, reading the
 * shared store from the `options.credentials` namespace owned by
 * `@algorandfoundation/credentials-core`. The platform `WithCredentials`
 * extensions load this bridge lazily as an optional peer.
 */

export * from "./extension.ts";
export * from "./remote.ts";
