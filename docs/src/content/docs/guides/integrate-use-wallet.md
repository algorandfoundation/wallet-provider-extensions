---
title: "Integrate with use-wallet"
description: Expose a provider-based wallet to dapps through the standard use-wallet API.
sidebar:
  order: 6
---

[use-wallet](https://github.com/TxnLab/use-wallet) is the standard way Algorand dapps talk to wallets. This guide shows how a wallet built on this stack plugs into it, using the adapter that ships in `examples/use-wallet-client`. For the background on how the layers relate, read [dApps](/concepts/dapps/) first.

## 1. Register the wallet in the dapp

On the dapp side, the integration is one factory call in the `WalletManager` catalog, next to the stock wallets:

```typescript
import { WalletManager } from "@txnlab/use-wallet-react";
import { dappWallet } from "./lib/provider/adapter";

const walletManager = new WalletManager({
  wallets: [dappWallet(), pera(), lute()],
  defaultNetwork: "testnet",
  options: { store },
});
```

From here the dapp code is plain use-wallet: list wallets, connect, read `activeAccount`, hand `transactionSigner` to `algosdk`. Nothing downstream knows a provider is involved.

## 2. How the adapter works

The adapter is a use-wallet wallet class that owns a composed provider. Its job is translation, not logic:

```typescript
export class ProviderAdapter extends BaseWallet<DappWalletOptions, ProviderWalletAccount> {
  public readonly provider: DappProvider;
  // ...
}

export function dappWallet(
  options?: DappWalletOptions & WalletFactoryOptions,
): WalletAdapterConfig<ProviderWalletAccount> {
  const { metadata, ...adapterOptions } = options ?? {};
  return {
    id: WALLET_ID,
    metadata: { ...ProviderAdapter.defaultMetadata, ...metadata },
    Adapter: ProviderAdapter as any,
    options: Object.keys(adapterOptions).length > 0 ? adapterOptions : undefined,
  };
}
```

The provider behind it composes the full stack, so the dapp session carries much more than signing:

```typescript
export const DappProvider = Provider.withExtensions([
  WithConnections,
  WithAccounts<Account>,
  WithIdentities<DappIdentity>,
  WithCredentials,
  WithPasskeys,
  WithKeyStore,
] as const);
```

## 3. The three mappings that matter

**Connect maps to a session.** `connect()` calls `provider.connection.connect("liquid-auth", ...)`, which parks the out-of-band request as a pending session in the connections store (the dapp's connect modal watches the store and renders the `liquid://` QR), and projects the wallet's shared records into use-wallet's account shape:

```typescript
private toWalletAccounts(session: ConnectionSession): ProviderWalletAccount[] {
  const accounts = (session.peer?.domains?.accounts ?? []) as Account[];
  return accounts.map((account, index) => ({
    name: account.name ?? `${this.metadata.name} Account ${index + 1}`,
    address: account.address,
    ...(account.type ? { type: account.type } : {}),
    ...(account.metadata ? { metadata: account.metadata } : {}),
  }));
}
```

**Signing maps to the session's RPC.** use-wallet hands the adapter a transaction group; the adapter flattens it ARC-0001 style, marks which entries this wallet may sign by matching senders against the session's addresses, and forwards base64 msgpack over the connection:

```typescript
private processEncodedTxns(txnGroup: Uint8Array[], indexesToSign?: number[]): WalletTransaction[] {
  return txnGroup.map((txnBuffer, index) => {
    const txn = algosdk.decodeUnsignedTransaction(txnBuffer);
    const isIndexMatch = !indexesToSign || indexesToSign.includes(index);
    const canSignTxn = this.addresses.includes(txn.sender.toString());
    const txnString = byteArrayToBase64(txn.toByte());

    return isIndexMatch && canSignTxn ? { txn: txnString } : { txn: txnString, signers: [] };
  });
}
```

```typescript
const stxns = await this.connection.signTransactions(sessionId, txns, walletIndexes);
return stxns.map((value) => (value === null ? null : base64ToByteArray(value)));
```

**Resume maps to the persisted session.** `resumeSession()` reads the persisted session, re-feeds the peer's domain records into the stores right away, and lets the transport re-establish in the background. The dapp shows accounts instantly even if the wallet is offline.

One store is shared between the `WalletManager` and the provider's accounts extension, so both layers see the same accounts with no synchronization code.

## 4. What your wallet must implement

The adapter runs in the dapp. Your wallet only has to be a well-behaved connections responder:

1. **Speak a shared protocol.** Compose `WithConnections` with Liquid Auth (or another protocol both sides install) and `accept()` the dapp's `liquid://` link.
2. **Share account records in the handshake.** Expose your accounts domain so `session.peer.domains.accounts` is populated. The adapter builds the use-wallet account list from exactly this.
3. **Answer transaction signing.** Handle the session's sign request by verifying, prompting the user, signing with your keystore, and returning base64 signed transactions (or `null` per declined entry).

A wallet composed from the keystore, accounts, and connections extensions already has all three pieces; the seams just need to be handed to the protocol. The `examples/react-native-wallet` app in the repository is a complete responder to crib from, and `examples/use-wallet-client` is the complete dapp.

## Related

- [dApps](/concepts/dapps/) for the architecture.
- [Connect a wallet and a dapp](/guides/connect-a-dapp/) for the raw session flow underneath.
