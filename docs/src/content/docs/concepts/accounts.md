---
title: "Accounts"
description: How the accounts domain models on-chain accounts, partitions them by wallet, and signs without holding keys.
sidebar:
  order: 4
---

An account is the thing your users actually care about: an address that can hold funds and sign transactions. The accounts domain gives every account in the app one reactive home, no matter where it came from. Some accounts are backed by keys in your keystore. Others arrive over a connection from a remote wallet. A few might be watch-only addresses with no key at all. To everything downstream they are all just accounts.

Like every package in this repo, accounts work standalone, as `addAccount` and friends are pure functions over a plain store (see the [accounts-core README](https://github.com/algorandfoundation/wallet-provider-extensions/tree/main/accounts/core#readme)), while `WithAccounts` provides first-class Provider integration.

## The account model

The core type is deliberately small:

```typescript
export interface BaseAccount {
  name: string;
  address: string;
  metadata?: Record<string, any>;
}

export interface Account extends BaseAccount {
  balance?: bigint;
  assets?: AccountAsset[];
  type?: "ed25519" | "lsig" | "falcon" | string;
}
```

Three things to notice:

- **The address is an opaque string.** The store never parses or validates it. Encoding an address from a public key is a chain concern and lives in bridges, which keeps the store reusable for any chain.
- **The type union is open.** `ed25519` is the everyday case, `falcon` is a post-quantum account, `lsig` is a program-controlled account, and the trailing `string` leaves room for kinds nobody has invented yet. See [Add a new account or identity type](/guides/add-account-types/).
- **There is no key material anywhere.** An account that can sign carries a `sign(txns)` function that delegates to whoever holds the key: the local keystore, or a remote wallet across a session. Consumers cannot tell the difference, and should not be able to.

## State is partitioned by wallet

The store state groups accounts under a **wallet key**, with one active wallet and one active account per wallet:

```typescript
export interface AccountStoreState<T = Account> {
  wallets: Partial<Record<string, WalletState<T>>>;
  activeWallet: string | null;
}

export interface WalletState<T = Account> {
  accounts: T[];
  activeAccount: T | null;
}
```

This shape exists because real apps hold accounts from more than one place at a time. Your own provider's accounts live under its wallet key. Each connected remote wallet gets its own partition under a session-scoped key of the form `remote:<sessionId>`. When a session ends, revoking its partition removes exactly its accounts and nothing else.

The shape is also intentionally the same one `use-wallet` uses to track wallets and active accounts, which is what lets a dapp share a single accounts store between the provider stack and its `WalletManager`. See [dApps](/concepts/dapps/).

## Where accounts come from

**The keystore bridge (a reference example).** `WithAccountsKeystore` (from `@algorandfoundation/accounts-keystore-extension`) watches the keystore and turns every account-capable key into an account. It recognizes `ed25519`, `hd-derived-ed25519`, and `falcon-1024` keys, addresses each one by its public key, which is deliberately simple for an example, and attaches a `sign` method that delegates back to the keystore. These accounts have `type: "keystore-account"` and record their origin in `metadata.keyType`.

**The Algorand extension (the production implementation).** `WithAlgorandAccounts` (from `@algorandfoundation/algorand-accounts-extension`) does the same watching with concrete chain semantics: ed25519 keys become standard Algorand addresses (`encodeAddress(publicKey)`), Falcon-1024 keys become go-algorand v5 canonical post-quantum addresses (a salted digest of the key, recorded as `pqScheme` / `pqSalt` in metadata), and every account is seeded with its ALGO balance and assets from algod, then kept live by a contained watchlist subscriber. Address derivation is a per-key-type encoder map, so future account kinds (Falcon LSIG, HybridLsig) plug in without changing the account shape.

**Remote sessions.** The connections domain shares account records during a handshake. `remoteAccountsMirror` receives them into a session partition and attaches a `sign` that forwards over the wire:

```typescript
const remote = remoteAccountsMirror(store, { walletKey: provider.id });
remote.receive("session-1", peerAccounts, { sign: sessionSigner });
```

Only data crosses the wire. A locally backed signer never travels; the receiving side gets a signer that calls home.

**You.** Anything else, from an indexer, an RPC service, or user input, goes in through `provider.account.store.addAccount(...)`. A watch-only account is just an account without a `sign` function.

## An account is a view, not a copy

The bridge does not copy key state into account state. An account holds a reference (`keyId` in its metadata) and a delegate. If the key disappears from the keystore, the bridge removes the account on the next reconcile. Truth stays in exactly one place per fact: the keystore knows keys, the accounts store knows accounts, and the bridge keeps the mapping honest by subscribing, not by being told.

## Where to go next

- [Manage accounts](/guides/manage-accounts/) for the concrete operations.
- [Provider](/concepts/provider/) for the routing rules bridges follow.
- [Connections](/concepts/connections/) for how remote accounts arrive.
