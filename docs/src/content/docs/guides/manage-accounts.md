---
title: "Manage accounts"
description: Add, list, switch, and remove accounts, and auto-populate them from the keystore.
sidebar:
  order: 3
---

This guide covers the everyday account operations. It assumes a composed provider; if you do not have one yet, start with [Compose a provider](/guides/compose-a-provider/). For the reasoning behind the model, see [Accounts](/concepts/accounts/).

## Set up the extension

Create a store, compose `WithAccounts`, and pass the store under the `accounts` key:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";
import type { Account, AccountStoreState } from "@algorandfoundation/accounts";
import { Store } from "@tanstack/store";

const accountStore = new Store<AccountStoreState<Account>>({
  wallets: {},
  activeWallet: null,
});

const MyProvider = Provider.withExtensions([WithAccounts]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  { accounts: { store: accountStore } },
);
```

## Add, get, and remove accounts

The store API lives at `provider.account.store`:

```typescript
await provider.account.store.addAccount({
  name: "Main Account",
  address: "VDB7...",
  type: "ed25519",
});

const account = await provider.account.store.getAccount("VDB7...");
await provider.account.store.removeAccount("VDB7...");
await provider.account.store.clear(); // remove everything under this wallet key
```

`addAccount` upserts: adding an account with an existing address updates it in place, which is handy for refreshing balances or metadata. Removing the active account promotes another one automatically.

## Switch the active account

Each wallet partition tracks one active account, and the store tracks one active wallet:

```typescript
await provider.account.store.setActiveAccount("VDB7...");

console.log(provider.accounts); // accounts of the active wallet, live
```

`provider.accounts` is a live getter over the store, so it always reflects the current partition.

## Auto-populate from the keystore

If your provider also has a keystore, add the bridge and every account-capable key becomes an account automatically. Order matters: the bridge must come after both stores it connects. `WithAccountsKeystore` (from `@algorandfoundation/accounts-keystore-extension`) is a reference example of the bridge pattern; for concrete Algorand addresses, use [`WithAlgorandAccounts`](#concrete-algorand-addresses-production) below.

```typescript
import { WithKeyStore } from "@algorandfoundation/keystore";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithAccountsKeystore } from "@algorandfoundation/accounts-keystore-extension";

const MyProvider = Provider.withExtensions([WithKeyStore, WithAccounts, WithAccountsKeystore]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    keystore: { store: keyStore },
    accounts: { store: accountStore },
  },
);

// Derive a key and watch the account appear.
const keyId = await provider.key.store.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");
console.log(provider.accounts); // now contains the derived account
```

Bridged accounts have `type: "keystore-account"` and carry a `sign(txns)` method that delegates to the keystore, so signing with them needs no extra wiring:

```typescript
const [account] = provider.accounts;
const [signed] = await account.sign([txnBytes]);
```

The bridge handles `ed25519`, `hd-derived-ed25519`, and `falcon-1024` keys, and identifies every account the same way: the account's `address` is `base64(publicKey)`, an opaque identifier rather than a chain address. That keeps the example chain-agnostic; deriving real Algorand addresses is the job of the production extension below.

## Concrete Algorand addresses (production)

`WithAlgorandAccounts` (from `@algorandfoundation/algorand-accounts-extension`) is the production Algorand implementation of the same pattern. It watches the keystore like the bridge does, but derives real chain addresses per key type and keeps balances and assets live from algod:

- `ed25519` and `hd-derived-ed25519` keys become standard Algorand addresses via `encodeAddress(publicKey)`.
- `falcon-1024` keys become go-algorand's canonical post-quantum addresses: `encodeAddress(canonicalPQAddress(publicKey).address)`, with the scheme recorded as `pqScheme`/`pqSalt` in the account metadata.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithAlgorandAccounts } from "@algorandfoundation/algorand-accounts-extension";

const MyProvider = Provider.withExtensions([WithKeyStore, WithAccounts, WithAlgorandAccounts]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    keystore: { store: keyStore },
    accounts: { store: accountStore },
    algorand: {
      network: "testnet-v1.0",
      algodConfig: { server: "https://testnet-api.algonode.cloud", port: 443, token: "" },
      // Optional: indexerConfig, hooks
    },
  },
);
```

Accounts arrive with `type: "algorand-account"`, a `sign(txns)` delegate to the keystore, and metadata pointing back at the originating key (`keyId`, `keyType`). The extension also mounts shared `algod`/`indexer` clients at `provider.algorand` and runs a contained subscriber that refreshes balances and assets as the watched addresses transact. See the [algorand-accounts-extension README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/accounts/algorand-extension#readme) for the standalone helpers and [Accounts](/concepts/accounts/) for the model.

## Render accounts reactively

Subscribe to the store where you render; in React, select the slice you need:

```tsx
import { useStore } from "@tanstack/react-store";

function AccountList() {
  const accounts = useStore(accountStore, (s) => s.wallets[s.activeWallet ?? ""]?.accounts ?? []);
  return (
    <ul>
      {accounts.map((a) => (
        <li key={a.address}>
          {a.name}: {a.address}
        </li>
      ))}
    </ul>
  );
}
```

## Observe operations with hooks

The store emits `add`, `remove`, `get`, `set-active`, and `clear` hooks, so you can log or audit account changes the same way you do keystore operations.

## Related

- [Accounts](/concepts/accounts/) for the model and where accounts come from.
- [Manage keys with the keystore](/guides/manage-keys/) for the key operations behind bridged accounts.
- [Add a new account or identity type](/guides/add-account-types/) to route your own kinds.
- The [algorand-accounts-extension README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/accounts/algorand-extension#readme) for address derivation and balance-sync helpers you can use standalone.
