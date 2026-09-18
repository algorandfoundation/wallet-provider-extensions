import { Store } from "@tanstack/store";
import { DEFAULT_STATE, type State } from "@txnlab/use-wallet";

/**
 * The ONE TanStack store shared between use-wallet's `WalletManager`
 * (`{ options: { store } }`, see `App.tsx`) and the Provider's accounts
 * store (`options.accounts.store`). Both systems read and write the same
 * reactive state: the adapter's session accounts land under its wallet key
 * (`"wallet-provider"`), while `provider.account.store` writes under the
 * provider's own key (`"use-wallet-client"`): one writer per wallet key.
 */
export const store = new Store<State>({ ...DEFAULT_STATE });
