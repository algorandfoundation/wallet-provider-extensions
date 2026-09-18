# Local Extensions

Local extensions allow you to extend the `ReactNativeProvider` with specific functionality for your application without needing to publish them as separate packages.

## Creating an Extension

An extension is a function that receives the `provider` and `options` and returns an object that matches the extension's interface. It can add new reactive state, new API methods, and even hook into existing extension methods.

### Example: `WithWatchedAccount`

In `extensions/example.ts`, we have an example of a local extension that adds "Watched Accounts" to the provider. These are accounts that only have a public address and are not backed by a secret key in the keystore. This extension leverages the `@algorandfoundation/accounts` to manage its data.

```typescript
import { type Provider } from "@algorandfoundation/wallet-provider";
import {
  type Account,
  type AccountStoreExtension,
  type AccountStoreOptions,
  addAccount,
  removeAccount,
} from "@algorandfoundation/accounts";

/**
 * Represents a watched account that only has a public address.
 */
export interface WatchedAccount extends Account {
  type: "watched";
  name: string;
}

/**
 * Type guard to narrow an account to a WatchedAccount.
 */
export function isWatchedAccount(account: Account): account is WatchedAccount {
  return account.type === "watched";
}

export const WithWatchedAccount = (
  provider: Provider<any> & AccountStoreExtension<Account>,
  options: AccountStoreOptions<WatchedAccount>,
) => {
  const { hooks, store } = options.accounts;

  return {
    get watchedAccounts() {
      return (provider.accounts || []).filter(isWatchedAccount);
    },
    watchedAccount: {
      addWatchedAccount: async (account: Omit<WatchedAccount, "type">) => {
        const watched: WatchedAccount = { ...account, type: "watched" };
        return hooks("add", addAccount, { store, account: watched });
      },
      removeWatchedAccount: async (address: string) => {
        return hooks("remove", removeAccount, { store, address });
      },
    },
  };
};
```

## Adding Extensions to the Provider

To use a local extension, you need to add it to the `EXTENSIONS` array in your `ReactNativeProvider` and define the corresponding properties on the class.

```typescript
// providers/ReactNativeProvider.tsx
import { WithWatchedAccount, WatchedAccount, WatchedAccountApi } from "@/extensions/example";

export class ReactNativeProvider extends Provider<typeof ReactNativeProvider.EXTENSIONS> {
  static EXTENSIONS = [
    // ...
    WithWatchedAccount,
  ] as const;

  // Define properties for reactive state and API
  watchedAccounts!: WatchedAccount[];
  watchedAccount!: WatchedAccountApi;
}
```

## Initializing the Extension

When constructing the `ReactNativeProvider`, you can pass options for your local extension, such as custom hooks.

```typescript
// app/_layout.tsx
new ReactNativeProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    // ... other extension options
    accounts: {
      store: accountsStore,
      hooks: accountHooks,
    },
  },
);
```

## Usage in Components

Once added to the provider, you can use the extension's state and API in your components via the `useProvider` hook.

```tsx
const { watchedAccounts, watchedAccount } = useProvider();

const onAdd = () => {
  watchedAccount.addWatchedAccount({
    address: "...",
    name: "My Watched Account",
    balance: 0n,
    assets: [],
  });
};

// Use type guards for narrowing
if (isWatchedAccount(someAccount)) {
  console.log(someAccount.name);
}
```
