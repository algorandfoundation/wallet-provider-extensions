import type {
  Account,
  AccountStoreExtension,
  AccountStoreOptions,
  AccountStoreState,
  BaseAccount,
} from "@algorandfoundation/accounts-core";
import type {
  AccountsRemoteNamespace,
  RemoteAccountsMirror,
} from "@algorandfoundation/accounts-connections-extension";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";

/**
 * Options for the unified Accounts extension.
 *
 * The `accounts` slice is the core store's (`AccountStoreOptions`), plus
 * the `remote` slice threaded to the lazily loaded connections bridge
 * (`@algorandfoundation/accounts-connections-extension`). Like the core's
 * generic options it replaces the registered non-generic `accounts` entry
 * with one typed against `T` and `S`.
 *
 * @template T - The account type stored under each wallet key.
 * @template S - The full store state shape; may structurally extend
 * {@link AccountStoreState} (e.g. use-wallet's `State<T>`).
 *
 * @example
 * ```typescript
 * const options: AccountsExtensionOptions<Account> = {
 *   accounts: {
 *     store,
 *     remote: { expose: (accounts) => accounts.map(({ metadata, ...rest }) => rest) },
 *   },
 * };
 * ```
 */
export interface AccountsExtensionOptions<
  T = Account,
  S extends AccountStoreState<T> = AccountStoreState<T>,
> extends Omit<ExtensionOptions, "accounts"> {
  /** Accounts-specific settings, typed against `T` and `S`. */
  accounts?: NonNullable<AccountStoreOptions<T, S>["accounts"]> & {
    /**
     * Options of the session-scoped remote mirror the connections
     * bridge mounts at `provider.account.remote`, e.g. an `expose`
     * projection normalizing addresses before they travel a
     * connection. The `walletKey` defaults to the extension's own.
     */
    remote?: AccountsRemoteNamespace<T & BaseAccount>;
  };
}

/**
 * Interface representing the unified Accounts extension.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts]);
 * const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});
 *
 * await provider.account.store.ready; // the connections bridge (if installed) is mounted
 * provider.account.remote?.expose();
 * ```
 */
export interface AccountsExtension<T> extends AccountStoreExtension<T> {
  account: AccountStoreExtension<T>["account"] & {
    store: AccountStoreExtension<T>["account"]["store"] & {
      /**
       * Resolves once this extension's dynamic bridge import has settled
       * (mounted, or swallowed when the connections peer is not
       * installed) — the accounts counterpart of the keystore's
       * `KeyStore.ready`. Never rejects. After it resolves,
       * `provider.account.remote` is present whenever
       * `@algorandfoundation/accounts-connections-extension` is
       * installed, so `await provider.account.store.ready` before
       * initiating a connection guarantees the first handshake
       * exchanges records instead of degrading to announce-only.
       */
      ready: Promise<void>;
    };
    /**
     * The session-scoped remote mirror contributed by the connections
     * bridge: the surface connection engines discover to exchange
     * account records. Attached asynchronously once
     * `@algorandfoundation/accounts-connections-extension` resolves;
     * absent when the peer is not installed.
     */
    remote?: RemoteAccountsMirror<T & BaseAccount>;
  };
}
