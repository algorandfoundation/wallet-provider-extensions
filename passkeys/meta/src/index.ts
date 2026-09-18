/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/passkeys` is the **meta package** for the
 * passkeys domain, mirroring `@algorandfoundation/accounts` and
 * `@algorandfoundation/identities`.
 *
 * It **owns** the unified {@link WithPasskeys} extension: it composes the
 * core store (`@algorandfoundation/passkeys-core`: `WithPasskeys` store
 * extension, store helpers, reconciliation, types) with the connections
 * bridge (`@algorandfoundation/passkeys-connections-extension`, an
 * optional peer loaded lazily to mount the session-scoped remote mirror
 * at `provider.passkey.remote`).
 *
 * The passkeys core is platform-neutral, so this package ships a single
 * entry; the React Native feeder lives in
 * `@algorandfoundation/react-native-passkeys` and composes the same core.
 */

export * from "@algorandfoundation/passkeys-core";
export { WithPasskeys } from "./extension.ts";
export type { PasskeysMetaExtension, PasskeysMetaOptions } from "./types.ts";
export type {
  PasskeysConnectionsExtension,
  PasskeysConnectionsOptions,
  RemotePasskeysMirror,
} from "@algorandfoundation/passkeys-connections-extension";
