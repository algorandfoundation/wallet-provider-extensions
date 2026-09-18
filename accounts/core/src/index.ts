/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/accounts-core` is the source-agnostic account store of
 * the accounts domain. The state is a plain `@tanstack/store`
 * `Store<AccountStoreState>` partitioned by wallet key, a structural twin of
 * use-wallet v5's store, so one instance can back both a `WalletManager` and
 * a Wallet Provider. The pure store functions (`addAccount`, `removeAccount`,
 * `getAccount`, `setActiveAccount`, `clearAccounts`) drive it standalone, and
 * the {@link WithAccounts} extension mounts the same functions at
 * `provider.account.store` (plus the reactive `accounts` getter) scoped to
 * `options.accounts.walletKey ?? provider.id`.
 *
 * Source bridges (`@algorandfoundation/accounts-keystore-extension`,
 * `@algorandfoundation/algorand-accounts-extension`,
 * `@algorandfoundation/accounts-connections-extension`) translate their
 * sources into these store mutations and augment the registered
 * {@link AccountsNamespace} (`options.accounts`) with their own fields.
 */

export * from "./extension.ts";
export * from "./store.ts";
export * from "./types.ts";
