import type { WithAccountsConnections as WithAccountsConnectionsType } from "@algorandfoundation/accounts-connections-extension";
import { WithAccounts as WithAccountsCore } from "@algorandfoundation/accounts-core";
import type { AccountStoreState, BaseAccount } from "@algorandfoundation/accounts-core";
import { Store } from "@tanstack/store";
import type { AccountsExtension, AccountsExtensionOptions } from "./types.ts";

/**
 * Unified extension that combines the account store and the connections
 * bridge.
 *
 * It always provides the account store (`@algorandfoundation/accounts-core`'s
 * `WithAccounts`), and lazily loads the connections bridge
 * (`@algorandfoundation/accounts-connections-extension`) to mount the
 * session-scoped remote mirror at `provider.account.remote`, so connection
 * engines can discover the accounts domain. A missing bridge peer degrades
 * silently to a local-only accounts surface.
 *
 * `provider.account.store.ready` resolves once the bridge import settled
 * (mounted, or swallowed when the peer is not installed) — the accounts
 * counterpart of the keystore's `provider.key.store.ready`. Await it before
 * initiating a connection to guarantee the mirror is mounted.
 *
 * @template T - The account type held by the store; pin it with an
 * instantiation expression (`WithAccounts<MyAccount>`) the same way the
 * core `WithAccounts` is pinned.
 * @template S - The full store state shape; may structurally extend
 * `AccountStoreState` (e.g. use-wallet's `State<T>`).
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The unified accounts extension.
 *
 * @example
 * ```typescript
 * const provider = Provider.withExtensions([WithAccounts]);
 * ```
 */
export const WithAccounts = <
  T extends BaseAccount,
  S extends AccountStoreState<T> = AccountStoreState<T>,
>(
  provider: any,
  options?: AccountsExtensionOptions<T, S>,
): AccountsExtension<T> => {
  // Resolve (or create) the concrete accounts store up front so the same
  // instance is shared with the dynamically loaded connections bridge.
  const accountsStore: Store<S> =
    options?.accounts?.store ??
    (new Store<AccountStoreState<T>>({ wallets: {}, activeWallet: null }) as Store<S>);

  const resolvedOptions: AccountsExtensionOptions<T, S> = {
    ...options,
    accounts: {
      ...options?.accounts,
      store: accountsStore,
    } as AccountsExtensionOptions<T, S>["accounts"],
  };

  // Load the account store (incrementally: reuses provider.account?.store if present).
  const accountStore = WithAccountsCore<T, S>(provider, resolvedOptions);

  const api = {
    get accounts(): T[] {
      return accountStore.accounts;
    },
    // Reuse (rather than shallow-copy) the core namespace object so the
    // remote mirror attached below also lives on the shared instance and
    // is not lost if a downstream consumer reads the original reference.
    account: accountStore.account,
  } as AccountsExtension<T>;

  // We need to provide a provider that includes the account store so that
  // WithAccountsConnections can reuse an already-mounted provider.account.remote.
  const bridgeProvider = Object.create(provider, {
    accounts: {
      get() {
        return accountStore.accounts;
      },
      enumerable: true,
    },
    account: {
      value: api.account,
      enumerable: true,
    },
  });

  // Dynamic import to keep the bridge an optional peer (and out of bundles
  // that never connect); the mirror is attached once the module resolves.
  const loadBridge = async (): Promise<void> => {
    const { WithAccountsConnections } =
      (await import("@algorandfoundation/accounts-connections-extension")) as {
        WithAccountsConnections: typeof WithAccountsConnectionsType;
      };
    const surface = WithAccountsConnections<T, S>(bridgeProvider, resolvedOptions);
    if (!api.account.remote) {
      api.account.remote = surface.account.remote;
    }
  };

  // Attach a no-op rejection handler so an unavailable bridge module (e.g.
  // peer not installed) does not surface as an unhandled promise rejection.
  const bridgeSettled = loadBridge().catch(() => {
    /* swallow: a missing bridge degrades to a local-only accounts surface */
  });

  // Attach onto the SHARED store API instance (the same object the core
  // mounted — possibly reused from a prior extension) so
  // `provider.account.store.ready` is visible to every consumer.
  api.account.store.ready = bridgeSettled;

  return api;
};
