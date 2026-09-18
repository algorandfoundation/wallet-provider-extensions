---
title: "Compose a provider"
description: Combine multiple extensions into a single, fully typed wallet provider.
sidebar:
  order: 1
---

This guide shows you how to assemble a provider from several extensions and wire it to your application's stores. Use it when you already know which capabilities you need (keystore, accounts, identities, logging) and want them on one typed instance.

## 1. Pick your extensions

For most apps, install the **meta package** for each domain (for example `@algorandfoundation/keystore`, `@algorandfoundation/accounts`, `@algorandfoundation/identities`). Meta packages pick the right platform adapter at runtime and enable optional bridges only when their dependencies are present. Reach for the individual core or bridge packages only when you need finer control. See [Packages](/concepts/packages/) for the full layout.

## 2. Create one store per domain

You own the stores. Create one reactive atom per domain and keep them at your app's composition root:

```typescript
import { Store } from "@tanstack/store";
import type { KeyStoreState } from "@algorandfoundation/keystore";
import type { AccountStoreState } from "@algorandfoundation/accounts";
import type { IdentityStoreState } from "@algorandfoundation/identities";

const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });
const accountsStore = new Store<AccountStoreState>({ wallets: {}, activeWallet: null });
const identitiesStore = new Store<IdentityStoreState>({ identities: [] });
```

Because you create the stores, you can also persist them, hydrate them on a server, inspect them in devtools, or swap them wholesale in tests. The provider operates on them; it does not own them.

## 3. Compose and instantiate

There are two equivalent styles. The functional style composes a class on the fly:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithIdentities } from "@algorandfoundation/identities";

const MyWallet = Provider.withExtensions([WithKeyStore, WithAccounts, WithIdentities]);

const wallet = new MyWallet(
  { id: "my-wallet", name: "My Wallet", icon: "https://example.com/icon.png" },
  {
    keystore: { store: keyStore },
    accounts: { store: accountsStore },
    identities: { store: identitiesStore },
  },
);
```

The class style is handy when you want a named, importable provider with extra typed properties:

```typescript
export class MyProvider extends Provider<typeof MyProvider.EXTENSIONS> {
  static EXTENSIONS = [WithKeyStore, WithAccounts, WithIdentities] as const;
}
```

Either way, TypeScript infers the combined surface. Everything each extension contributes shows up fully typed on the instance, and the options parameter accepts exactly the namespaces your extensions registered.

## 4. Mind the ordering

Extensions apply in order, and each one receives the provider as it exists so far. Bridges that read from the keystore must come after it:

```typescript
// Correct: the accounts bridge can see everything WithKeyStore contributed.
Provider.withExtensions([WithKeyStore, WithAccounts, WithAccountsKeystore]);

// Wrong: the bridge applies first and finds no keystore.
Provider.withExtensions([WithAccountsKeystore, WithKeyStore, WithAccounts]);
```

Meta packages handle this for you, which is another reason to prefer them.

## 5. Use the composed provider

Invoke commands on the provider, subscribe to the stores wherever you render:

```typescript
await wallet.key.store.ready;

// Commands go through the provider.
await wallet.key.store.generate({
  type: "seed",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
});

// Reads can go through convenience getters...
console.log(wallet.keys);

// ...or reactively through the store you created.
accountsStore.subscribe(() => {
  console.log("accounts changed:", accountsStore.state.wallets);
});
```

In React, bind a store slice with a selector so components re-render only when their slice changes:

```tsx
import { useStore } from "@tanstack/react-store";

function AccountList() {
  const accounts = useStore(accountsStore, (s) => s.wallets["my-wallet"]?.accounts ?? []);
  return (
    <ul>
      {accounts.map((a) => (
        <li key={a.address}>{a.address}</li>
      ))}
    </ul>
  );
}
```

Components read from stores and use the provider only to invoke commands. Code that only displays state never needs the provider at all.

## Related

- [Getting started](/tutorials/getting-started/)
- [Create an extension](/guides/create-an-extension/)
- [Architecture](/concepts/architecture/)
