import { createContext, type ReactNode } from "react";
import { Provider } from "@algorandfoundation/wallet-provider";

import { WithKeyStore } from "@algorandfoundation/react-native-keystore";
import { Account, AccountStoreApi, WithAccountStore } from "@algorandfoundation/accounts-store";
import type { KeyStoreAPI, Key } from "@algorandfoundation/keystore";
import { type LogMessage, WithLogStore, type LogStoreApi } from "@algorandfoundation/log-store";
import { keyStoreHooks } from "@/stores/before-after";
import {
  KeystoreAccount,
  WithAccountsKeystore,
} from "@algorandfoundation/accounts-keystore-extension";
import {
  AlgorandAccount,
  WithAlgorandAccounts,
} from "@algorandfoundation/algorand-accounts-extension";
import { WithIdentities, type IdentitiesExtension } from "@algorandfoundation/identities-extension";
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
    WithLogStore,
    WithKeyStore,
    WithAccountStore<AppAccount>,
    WithAccountsKeystore,
    WithAlgorandAccounts,
    WithIdentities,
    WithWatchedAccount,
  ] as const;

  /** Reactive array of keys in the keystore */
  keys!: Key[];
  /** Reactive array of accounts in the account store */
  accounts!: AppAccount[];
  /** Reactive array of log messages */
  logs!: LogMessage[];
  /** Reactive array of identities */
  identities!: IdentitiesExtension["identities"];
  /** Current status of the keystore (e.g., 'idle', 'generating') */
  status!: string;

  /** API for account operations */
  account!: {
    store: AccountStoreApi<AppAccount>;
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
