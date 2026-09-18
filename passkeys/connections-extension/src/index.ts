/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/passkeys-connections-extension` is the **bridge**
 * between the passkeys store (`@algorandfoundation/passkeys-core`) and the
 * connections domain seam. The pure {@link remotePasskeysMirror} helper turns a
 * `Store<PasskeysState>` into the session-scoped `{ expose, receive, revoke }`
 * mirror the connections engines duck-type to exchange passkey metadata over a
 * session; the {@link WithPasskeysConnections} extension mounts it at
 * `provider.passkey.remote` over the shared store passed via
 * `options.passkeys.store`.
 *
 * The mirror runs standalone over any passkeys store. The meta package
 * (`@algorandfoundation/passkeys`) and the React Native package load this
 * bridge lazily as an optional peer.
 */

export * from "./extension.ts";
export * from "./remote.ts";
