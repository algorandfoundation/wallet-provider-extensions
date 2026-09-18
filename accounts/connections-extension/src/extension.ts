import type {
  Account,
  AccountStoreState,
  BaseAccount,
  WalletKey,
} from "@algorandfoundation/accounts-core";
import type { ExtensionOptions, Provider } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import { remoteAccountsMirror } from "./remote.ts";
import type { RemoteAccountsMirror, RemoteAccountsMirrorOptions } from "./remote.ts";

/**
 * The `options.accounts.remote` block this bridge adds to the shared
 * `options.accounts` namespace (see
 * {@link import("@algorandfoundation/accounts-core").AccountsNamespace}):
 * the {@link RemoteAccountsMirrorOptions} minus `walletKey`, which always
 * defaults to the extension's own.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   {
 *     accounts: {
 *       store: accountsStore,
 *       remote: { expose: (accounts) => accounts.filter((a) => a.type !== "watch") },
 *     },
 *   },
 * );
 * ```
 */
export type AccountsRemoteNamespace<T extends BaseAccount = Account> = Omit<
  RemoteAccountsMirrorOptions<T>,
  "walletKey"
>;

declare module "@algorandfoundation/accounts-core" {
  /**
   * Connections-bridge additions to the shared `options.accounts` namespace.
   */
  interface AccountsNamespace {
    /**
     * Options of the session-scoped remote mirror mounted at
     * `provider.account.remote`, see {@link AccountsRemoteNamespace}.
     */
    remote?: AccountsRemoteNamespace;
  }
}

/**
 * Options for the AccountsConnections bridge extension.
 *
 * Generic narrowing of the registered `options.accounts` namespace: the
 * `accounts` slice mirrors the shape `WithAccounts` reads
 * (`@algorandfoundation/accounts-core`'s `AccountStoreOptions`) with the
 * `remote` block typed against the concrete account type, so the same
 * options object can be threaded to both extensions.
 *
 * @template T - The account type stored under each wallet key.
 * @template S - The full store state shape; may structurally extend
 * {@link AccountStoreState} (e.g. use-wallet's `State<T>`).
 *
 * @example
 * ```typescript
 * const options: AccountsConnectionsOptions<Account> = {
 *   accounts: { store: accountsStore, remote: { expose: (accounts) => accounts } },
 * };
 * ```
 */
export interface AccountsConnectionsOptions<
  T = Account,
  S extends AccountStoreState<T> = AccountStoreState<T>,
> extends Omit<ExtensionOptions, "accounts"> {
  /** Accounts-specific settings, typed against `T` and `S`. */
  accounts?: {
    /**
     * The **shared** TanStack store instance backing the account state:
     * the same instance passed to `WithAccounts`. Required — the bridge
     * mirrors a peer's records into the accounts store, it never owns one.
     */
    store?: Store<S>;

    /**
     * The wallet key {@link RemoteAccountsMirror.expose} lists.
     * Defaults to the provider's `id`, the same key `WithAccounts`
     * scopes to.
     */
    walletKey?: WalletKey;

    /**
     * Options of the session-scoped remote mirror mounted at
     * `provider.account.remote`, e.g. an `expose` projection
     * normalizing addresses before they travel a connection. The
     * `walletKey` defaults to the extension's own.
     */
    remote?: AccountsRemoteNamespace<T & BaseAccount>;
  };
}

/**
 * The surface contributed by {@link WithAccountsConnections}.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * const records = provider.account.remote.expose();
 * provider.account.remote.receive("session-1", peerRecords, { sign: sessionSigner });
 * ```
 */
export interface AccountsConnectionsExtension<T> {
  /**
   * The accounts namespace member the bridge contributes.
   */
  account: {
    /**
     * The session-scoped remote mirror (see
     * {@link import("./remote.ts").remoteAccountsMirror}): the surface
     * connection engines discover to exchange account records.
     */
    remote: RemoteAccountsMirror<T & BaseAccount>;
  };
}

/**
 * Bridge extension that mounts the accounts store's session-scoped
 * remote mirror at `provider.account.remote`, the surface the
 * connections packages' `discoverDomains` duck-types to exchange
 * account records over a session.
 *
 * Requires the shared accounts store (`options.accounts.store`) — the
 * same instance backing `WithAccounts` — so mirrored records ride the
 * same reactive state the local wallets live in. Mounting is
 * idempotent: an already-mounted `provider.account.remote` is reused.
 *
 * @template T - The account type stored under each wallet key.
 * @template S - The full store state shape; may structurally extend
 * {@link AccountStoreState} (e.g. use-wallet's `State<T>`).
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension; see
 *   {@link AccountsConnectionsOptions} (`options.accounts.store` is required).
 * @returns The accounts-connections bridge extension.
 * @throws When `options.accounts.store` is missing.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts, WithAccountsConnections]);
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   { accounts: { store: accountsStore, remote: { expose: (accounts) => accounts } } },
 * );
 * ```
 */
export const WithAccountsConnections = <
  T extends BaseAccount,
  S extends AccountStoreState<T> = AccountStoreState<T>,
>(
  provider: Provider<any> & Partial<AccountsConnectionsExtension<T>>,
  options?: AccountsConnectionsOptions<T, S>,
): AccountsConnectionsExtension<T> => {
  const store: Store<S> | undefined = options?.accounts?.store;
  if (!store) {
    throw new Error(
      "WithAccountsConnections requires options.accounts.store (the shared accounts store)",
    );
  }
  const walletKey = options?.accounts?.walletKey ?? provider.id;

  return {
    account: {
      remote:
        provider.account?.remote ??
        remoteAccountsMirror<T, S>(store, { ...options?.accounts?.remote, walletKey }),
    },
  };
};
