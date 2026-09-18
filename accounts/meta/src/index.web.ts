/**
 * @module default
 * @packageDocumentation
 *
 * Browser condition entry for `@algorandfoundation/accounts`, resolved via the
 * `browser` export condition. It is currently identical to the
 * platform-neutral composition: the core store
 * (`@algorandfoundation/accounts-core`, re-exported in full so the pure store
 * functions run standalone) plus the unified `WithAccounts` extension that
 * lazily mounts the connections bridge at `provider.account.remote`. A browser
 * accounts package will replace this delegation when a real platform seam
 * lands, without any application-facing change.
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
