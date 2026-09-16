# 🪙 @algorandfoundation/algorand-accounts-extension

Concrete Algorand accounts from keystore keys.

This package is the production Algorand accounts implementation: it turns keystore keys into accounts with **real Algorand addresses**, seeds their balances and assets from algod, and keeps them in sync through a contained [algokit-subscriber](https://github.com/algorandfoundation/algokit-subscriber-ts) watchlist. The addressing helpers are pure functions that run fully standalone; the package also ships first-class support for the Algorand Wallet Provider via the `WithAlgorandAccounts` extension. Both usage modes are equal citizens of the API.

## ✨ Features

- **Concrete Addressing**: `hd-derived-ed25519` and standalone `ed25519` keys become standard Algorand addresses (`encodeAddress(publicKey)`); `falcon-1024` keys become go-algorand v5 canonical post-quantum addresses (`encodeAddress(canonicalPQAddress(publicKey).address)`) with `pqScheme` / `pqSalt` recorded in account metadata.
- **Extensible Encoder Seam**: address derivation is a per-key-type encoder map — future account kinds (Falcon LSIG, the upcoming HybridLsig combining Ed25519 and Falcon-1024) plug in as new encoders without changing the account shape.
- **Live Balances**: accounts are seeded with their ALGO balance and ASA holdings from algod, then kept current by a polling watchlist subscriber that starts and stops itself with the account set.
- **Integrated Signing**: every account carries a `sign` method that delegates to the keystore backend (hookable via `before-after-hook`).
- **Shared Clients**: mounts typed algod / indexer clients on `provider.algorand` so hooks and screens reuse a single client pair.

## 🧱 Core Components

- [**`WithAlgorandAccounts`**](./src/extension.ts): The Wallet Provider Extension that populates the account store from the keystore.
- [**`algorandAddressForKey`** / **`ALGORAND_ADDRESS_ENCODERS`**](./src/address.ts): The per-key-type address derivation seam.
- [**`canonicalPQAddress`** / **`pqAddress`**](./src/pq-address.ts): go-algorand v5's native post-quantum address scheme, verified against its known-answer vectors.
- [**`getAlgorandBalances`** / **`createSubscriberWithWatchlist`**](./src/algorand.ts): balance seeding and the contained polling subscriber.
- [**`AlgorandAccount`**](./src/types.ts): the account shape, including key-derivation and PQ-scheme metadata.

## 📥 Installation

```bash
pnpm add @algorandfoundation/algorand-accounts-extension @tanstack/store before-after-hook
```

`@algorandfoundation/logs` is an optional peer — when a log extension is mounted on the provider, the extension reports its sync activity through it.

## 🚀 Quick Start

### Standalone: Addressing Helpers

The address derivation is pure functions — no Provider, store, or keystore required:

```typescript
import {
  algorandAddressForKey,
  canonicalPQAddress,
  PQ_SCHEME_FALCON1024,
} from "@algorandfoundation/algorand-accounts-extension";
import { encodeAddress } from "algosdk";

// Any keystore `Key` (ed25519, hd-derived-ed25519, falcon-1024) → Algorand address
const encoded = algorandAddressForKey(key);
if (encoded) {
  console.log(encoded.address); // 58-character Algorand address
  console.log(encoded.metadata); // { pqScheme: "f1", pqSalt: 0 } for falcon keys
}

// Or derive a post-quantum address directly from raw Falcon-1024 public key bytes
const { address, salt } = canonicalPQAddress(falconPublicKey, PQ_SCHEME_FALCON1024);
console.log(encodeAddress(address));
```

The balance helpers are equally standalone — pass your own `AlgorandClient`:

```typescript
import {
  createSubscriberWithWatchlist,
  getAlgorandBalances,
} from "@algorandfoundation/algorand-accounts-extension";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";

const algorand = AlgorandClient.testNet();
const { balance, assets } = await getAlgorandBalances(algorand, address);

const subscriber = createSubscriberWithWatchlist(algorand, [address], (addr, assetId, amount) => {
  console.log(`balance change on ${addr}: asset ${assetId} ${amount}`);
});
subscriber.start();
```

### With a Provider

The `WithAlgorandAccounts` extension requires both `WithAccounts` and `WithKeyStore` (or a compatible keystore extension) to be present on the provider:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithKeyStore } from "@algorandfoundation/keystore-react-native"; // or any keystore implementation
import { WithAlgorandAccounts } from "@algorandfoundation/algorand-accounts-extension";

const MyProvider = Provider.withExtensions([WithAccounts, WithKeyStore, WithAlgorandAccounts]);

const provider = new MyProvider(
  { id: "my-provider", name: "My Provider" },
  {
    accounts: { store: accountStore },
    keystore: { store: keyStore },
    algorand: {
      network: "testnet-v1.0",
      algodConfig: { server: "https://testnet-api.algonode.cloud", port: 443, token: "" },
      // Optional: indexerConfig, hooks
    },
  },
);
```

Once configured, compatible keys added to the keystore automatically appear as Algorand accounts with live balances:

```typescript
// The account is added with its concrete Algorand address, balance and assets
console.log(provider.accounts);

// Sign using the account's sign method (delegates to the keystore)
const account = provider.accounts[0];
const signed = await account.sign([txnData]);

// Shared algod / indexer clients mounted by the extension
const info = await provider.algorand.algod.accountInformation(account.address).do();
```

Accounts are written under a wallet key (defaults to the provider's `id`), mirroring use-wallet's per-wallet partitioning.

## 🔑 Address Derivation

| Key type             | Address                                                | Metadata             |
| -------------------- | ------------------------------------------------------ | -------------------- |
| `hd-derived-ed25519` | `encodeAddress(publicKey)` (address context only)      | —                    |
| `ed25519`            | `encodeAddress(publicKey)`                             | —                    |
| `falcon-1024`        | `encodeAddress(canonicalPQAddress(publicKey).address)` | `pqScheme`, `pqSalt` |

A Falcon-1024 public key (1793 bytes) is far too large to be the address the way an ed25519 public key is, so the address is a domain-separated digest instead: `sha512_256("PQA" || scheme || salt || publicKey)`, where the canonical salt is the lowest value whose resulting address does not decode as an Edwards25519 curve point. This is go-algorand v5's native PQ address scheme (`data/basics/pq_address.go`), and the implementation is verified against its known-answer vectors.

Falcon **LSIG** accounts and the upcoming **HybridLsig** (Ed25519 + Falcon-1024) are anticipated by the encoder seam but not yet implemented.

## 📖 API Documentation

For detailed information on types and methods, see the [TypeDocs](https://algorandfoundation.github.io/wallet-provider-extensions/accounts/algorand-extension/).

## 📜 License

Apache-2.0
