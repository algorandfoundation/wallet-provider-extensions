---
title: "Add a new account or identity type"
description: Extend the open unions with your own account kinds and identity shapes.
sidebar:
  order: 12
---

The account and identity models are open unions, so new kinds are purely additive. You never touch the stores, the UI, or the DID projection to introduce one. This guide lists the steps for each side.

## Background: the unions are open

```typescript
// accounts/core/src/types.ts
export type AccountType = "ed25519" | "lsig" | "falcon" | string;

// identities/core/src/types.ts
export type IdentityType = "xhd" | "did:key" | string;
```

The named members are examples of shapes the system anticipates: `falcon` is a post-quantum signature scheme (the keystore ships a Falcon-1024 shim), `lsig` is a program-controlled logic-signature account with no seed phrase at all. The trailing `string` leaves the door open for yours.

## Add a new account kind

1. **Route its keys in a bridge.** Give the new kind its own key `context` (or its own extension) and route matching keys from the keystore into the accounts store, the same way the example bridge (`accounts-keystore-extension`) routes context `0` keys:

   ```typescript
   const isMyKind = k.type === "my-key-type" && k.publicKey;
   if (isMyKind) {
     addAccount({ store: accountStore, walletKey, account: createMyAccount(k.id, address, ...) });
   }
   ```

2. **Give it an address encoder.** Turning a public key into an address is a chain-specific concern and belongs inside your bridge. Post-quantum keys hash differently; LSIG accounts derive their address from a program. The generic accounts store treats `address` as an opaque string and never inspects it.

3. **Project it into the DID document.** Emit a new verification-method `type` for it, exactly as P-256 passkeys already appear as `JsonWebKey2020` alongside Ed25519 keys.

Not one line of `addAccount`, the accounts store, the UI, or the DID projection changes.

## Add a new identity shape

Identities follow the mirror image of the same steps. An identity need not descend from the wallet seed the way `"xhd"` identities do; a bridge can add it from an entirely different source (think `did:web`, `did:jwk`, verifiable-credential holders, or an ISO 18013-5 `mdoc`).

1. **Route it into the identities store under its own `type`:**

   ```typescript
   await provider.identity.store.addIdentity({
     type: "mdoc",
     address: documentId,
     metadata: { issuer, docType },
   });
   ```

2. **Teach the projection how to describe it.** A `did:key` identity emits a DID document. An `mdoc` identity might instead surface its credential metadata, or appear as an additional `service` or verification entry. `Identity.didDocument` is optional and `Identity.metadata` is free-form, so the store already has somewhere to put a shape that is not a classic DID.

3. **Leave everything downstream alone.** Consumers keep subscribing to the one identities store and pick up your new kind automatically.

## Keep sign delegation intact

Whatever the kind, model signing the same way the built-in kinds do: the account holds a `sign` function and a reference, never key material. For a local key, delegate to the keystore. For a remote key, delegate across the RPC connection:

```typescript
addAccount({
  store: accountStore,
  walletKey,
  account: {
    name: "Remote Account",
    address,
    type: "ed25519",
    // No local key. Forward the request to the connected wallet over RPC.
    sign: (txns) => rpc.request("signTransactions", { address, txns }),
  },
});
```

Nothing downstream can tell the difference. A remote account is still just an account.

## Related

- [Provider](/concepts/provider/)
- [Create an extension](/guides/create-an-extension/)
