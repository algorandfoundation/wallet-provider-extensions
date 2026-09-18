/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/accounts` is the **meta package** for the
 * accounts domain. Its `package.json` `exports` map uses runtime/bundler
 * conditions (`react-native` / `browser` / `node`), mirroring
 * `@algorandfoundation/keystore`, `@algorandfoundation/identities`, and
 * `@algorandfoundation/credentials`.
 *
 * Unlike the thinner metas, this package **owns** the unified
 * {@link WithAccounts} extension: it composes the core store
 * (`@algorandfoundation/accounts-core`: `WithAccounts` store extension,
 * store helpers, types) with the connections bridge
 * (`@algorandfoundation/accounts-connections-extension`, an optional peer
 * loaded lazily to mount the session-scoped remote mirror at
 * `provider.account.remote`).
 *
 * Today every condition resolves to the same platform-neutral composition.
 * Per-platform accounts packages will slot into the corresponding conditions
 * later without any application-facing change. Everything core exports is
 * re-exported here, so the pure store functions run standalone from the same
 * install.
 */

export * from "@algorandfoundation/accounts-core";
export { WithAccounts } from "./extension.ts";
export type { AccountsExtension, AccountsExtensionOptions } from "./types.ts";
export type {
  AccountsConnectionsExtension,
  AccountsConnectionsOptions,
  AccountsRemoteNamespace,
  RemoteAccountsMirror,
  RemoteAccountsMirrorOptions,
} from "@algorandfoundation/accounts-connections-extension";
