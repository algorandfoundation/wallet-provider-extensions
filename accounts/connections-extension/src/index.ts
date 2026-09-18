/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/accounts-connections-extension` bridges the accounts
 * store and the connections domain seam. The pure {@link remoteAccountsMirror}
 * helper mirrors a remote peer's accounts under a session-scoped wallet key
 * (`remote:<sessionId>`) in the same reactive `@tanstack/store` state the
 * local wallets live in, and drops them again when the session ends; it runs
 * fully standalone over any `Store<AccountStoreState>`.
 *
 * The {@link WithAccountsConnections} extension mounts that mirror at
 * `provider.account.remote` (`{ expose, receive, revoke }`), the surface the
 * connections engines duck-type to exchange account records, over the
 * **shared** accounts store passed as `options.accounts.store`. It augments
 * the core `options.accounts` namespace with a `remote` block
 * ({@link AccountsRemoteNamespace}) for the outbound `expose` projection.
 */

export * from "./extension.ts";
export * from "./remote.ts";
