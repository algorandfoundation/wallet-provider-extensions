import { createContext, type ReactNode } from "react";
import { Provider } from "@algorandfoundation/wallet-provider";

import { WithMigrations, type MigrationsApi } from "@algorandfoundation/provider-migrations";
import {
  WithKeyStore,
  type Key,
  type KeyStoreAPI,
  type KeyStoreCapability,
} from "@algorandfoundation/keystore";
import {
  Account,
  AccountStoreApi,
  RemoteAccountsMirror,
  WithAccounts,
} from "@algorandfoundation/accounts";
import { type LogMessage, WithLogs, type LogStoreApi } from "@algorandfoundation/logs";
import { keyStoreHooks } from "@/stores/before-after";
import {
  KeystoreAccount,
  WithAccountsKeystore,
} from "@algorandfoundation/accounts-keystore-extension";
import {
  AlgorandAccount,
  WithAlgorandAccounts,
} from "@algorandfoundation/algorand-accounts-extension";
import { WithIdentities, type IdentitiesExtension } from "@algorandfoundation/identities";
import {
  WithCredentials,
  type Credential,
  type ReactNativeCredentialsExtension,
} from "@algorandfoundation/credentials";
import {
  WithConnections,
  type ConnectionSession,
  type ReactNativeConnectionsExtension,
} from "@algorandfoundation/connections";
import {
  WithPasskeys,
  type ReactNativePasskeysExtension,
} from "@algorandfoundation/react-native-passkeys";
import { WithPasskeysKeystore } from "@algorandfoundation/passkeys-keystore-extension";
import type { Passkey } from "@algorandfoundation/passkeys-core";
import { WithWatchedAccount, WatchedAccount } from "@/extensions/example";

export type AppAccount = WatchedAccount | AlgorandAccount | KeystoreAccount | Account;

/**
 * The React Native Provider for the wallet application.
 * Composes multiple extensions to provide a unified API and reactive state.
 *
 * @example
 * ```typescript
 * const provider = new ReactNativeProvider({ id: "my-wallet", name: "My Wallet" }, options);
 * ```
 */
export class ReactNativeProvider extends Provider<typeof ReactNativeProvider.EXTENSIONS> {
  static EXTENSIONS = [
    WithMigrations,
    WithLogs,
    WithKeyStore,
    WithAccounts<AppAccount>,
    WithAccountsKeystore,
    WithAlgorandAccounts,
    WithIdentities,
    WithCredentials,
    WithConnections,
    WithPasskeys,
    WithPasskeysKeystore,
    WithWatchedAccount,
  ] as const;

  /** Data migration registry and run control */
  migrations!: MigrationsApi;
  /** Reactive array of keys in the keystore */
  keys!: Key[];
  /** Reactive array of accounts in the account store */
  accounts!: AppAccount[];
  /** Reactive array of log messages */
  logs!: LogMessage[];
  /** Reactive array of identities */
  identities!: IdentitiesExtension["identities"];
  /** Reactive array of Verifiable Credentials held by the wallet */
  credentials!: Credential[];
  /** Reactive array of remote dapp connection sessions */
  connections!: ConnectionSession[];
  /** Reactive array of the credential provider's stored passkeys */
  passkeys!: Passkey[];
  /** Current status of the keystore (e.g., 'idle', 'generating') */
  status!: string;
  /** Reactive list of active keystore capabilities (host + shim), tagged by source */
  algorithms!: KeyStoreCapability[];

  /** API for account operations (store + the session-scoped remote mirror) */
  account!: {
    store: AccountStoreApi<AppAccount> & { ready: Promise<void> };
    /**
     * The session-scoped remote mirror, attached once the accounts meta's
     * connections bridge resolves; `await account.store.ready` guarantees
     * it is mounted.
     */
    remote?: RemoteAccountsMirror<AppAccount>;
  };
  /**
   * API for cryptographic key operations.
   * Extends the base {@link KeyStoreAPI} with clearing and hooks.
   */
  key!: {
    store: KeyStoreAPI & { clear: () => Promise<void>; hooks: typeof keyStoreHooks };
  };
  /** API for logging operations */
  log!: LogStoreApi;
  /** API for identity operations */
  identity!: IdentitiesExtension["identity"];
  /** API for credential operations (store + Digital Credentials platform seam) */
  credential!: ReactNativeCredentialsExtension["credential"];
  /** API for remote dapp connections (accept / resume / disconnect) */
  connection!: ReactNativeConnectionsExtension["connection"];
  /** API for passkey operations (refresh / remove / reconcile / provider status) */
  passkey!: ReactNativePasskeysExtension["passkey"];
}

export const AlgorandContext = createContext<null | ReactNativeProvider>(null);

/** Props for the {@link AlgorandProvider} component */
export interface AlgorandProviderProps {
  /** React children to render within the provider */
  children: ReactNode;
  /** The concrete provider instance to use */
  provider: ReactNativeProvider;
}
/**
 * Context provider component that makes the {@link ReactNativeProvider} available to hooks.
 *
 * @example
 * ```tsx
 * <AlgorandProvider provider={new ReactNativeProvider(...)}>
 *   <App />
 * </AlgorandProvider>
 * ```
 */
export function AlgorandProvider({ children, provider }: AlgorandProviderProps) {
  return <AlgorandContext.Provider value={provider}>{children}</AlgorandContext.Provider>;
}
