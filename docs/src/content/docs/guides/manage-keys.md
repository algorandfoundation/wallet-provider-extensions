---
title: "Manage keys with the keystore"
description: Generate seeds, derive Ed25519 accounts and post-quantum Falcon-1024 keys, sign, verify, and store application secrets.
sidebar:
  order: 2
---

This guide covers the everyday key operations once you have a provider with the keystore extension. If you have not set one up yet, do the [Getting started](/tutorials/getting-started/) tutorial first.

All operations below run against `provider.key.store` and refer to keys by **id**. Secret material never leaves the keystore.

## Import a seed from a recovery phrase

A seed is the chunk of random bytes everything else grows from. Turn a mnemonic phrase into seed bytes and import them:

```typescript
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const mnemonic = generateMnemonic(wordlist, 256); // or a phrase the user typed in
const seed = await mnemonicToSeed(mnemonic);
const seedId = await provider.key.store.importSeed(seed, { name: "Wallet Seed" });
```

Show the mnemonic to the user once and never store it yourself. The keystore seals the seed bytes; the phrase can restore them on any device.

## Derive an HD root key and accounts

Grow a root key from the seed, then derive as many account keys as you need along BIP44 paths:

```typescript
const rootId = await provider.key.store.generate({
  type: "hd-root-key",
  algorithm: "raw",
  extractable: false,
  keyUsages: ["deriveBits", "deriveKey"],
  params: { parentKeyId: seedId },
});

const firstAccount = await provider.key.store.deriveFromSeed(rootId, "m/44'/283'/0'/0/0");
const secondAccount = await provider.key.store.deriveFromSeed(rootId, "m/44'/283'/1'/0/0");
```

One recovery phrase now restores every account, because they all trace back to the same seed.

## Derive a post-quantum Falcon-1024 key

Ed25519 is not the only first-class signing key. The same seed can back a **post-quantum Falcon-1024** key, generated through exactly the same API:

```typescript
const falconId = await provider.key.store.generate({
  type: "falcon-1024",
  algorithm: "Falcon-1024",
  extractable: false,
  keyUsages: ["sign", "verify"],
  params: { parentKeyId: seedId },
});
```

Because it grows from the same seed, one recovery phrase restores your classical Ed25519 accounts and your post-quantum keys alike. To give Falcon keys concrete on-chain addresses (canonical post-quantum digests), use `@algorandfoundation/algorand-accounts-extension`; see [Manage accounts](/guides/manage-accounts/).

## Sign and verify

```typescript
const message = new TextEncoder().encode("hello");
const signature = await provider.key.store.sign(firstAccount, message);
const ok = await provider.key.store.verify(firstAccount, message, signature); // true
```

The calls are identical for every key type: pass `falconId` instead of `firstAccount` and the keystore signs with the post-quantum key, secret material staying sealed either way.

## List keys and watch the status

The store's state is safe to render. It holds metadata only:

```typescript
console.log(provider.keys);
// [{ id, type, algorithm, publicKey, metadata, ... }, ...]

console.log(store.state.status);
// "idle" | "generating" | "signing" | "ready" | ...
```

When a store has a lifecycle, guard on `status` before acting on a snapshot, so you never act on an in-flight state.

## Check which algorithms are available

Different environments have different capabilities. The keystore reports what is active in `algorithms`, tagged by origin:

```typescript
for (const cap of provider.algorithms) {
  console.log(cap.source, cap.algorithm);
  // "host" Ed25519          (built-in SubtleCrypto)
  // "shim" BIP32-Ed25519    (added by a shim)
}
```

If you do not configure shims explicitly, the engine enables every algorithm whose supporting library is installed and quietly skips the rest. The shipped shims include `BIP32-Ed25519` (HD derivation), `Falcon-1024` (post-quantum signatures), `Deterministic-P256` (passkey-style keys), `BIP39`, and `Algo25` mnemonics.

## Store application secrets

Alongside keys, the keystore has a small `secrets` area for plain values with no crypto role, such as an API token. Unlike key material, secrets can be read back, but they are still sealed at rest through the same driver:

```typescript
const id = await provider.key.store.secrets.put("my-api-token", { name: "API Token" });
const value = await provider.key.store.secrets.get(id); // the bytes back
```

## Observe operations with hooks

Run code before or after any keystore operation, or when one fails, without changing the operation itself:

```typescript
provider.key.store.hooks.before("generate", () => {
  console.log("about to generate a key");
});
```

Hooks are useful for logging, auditing, and analytics.

## Work from the terminal

The Node package ships a `keystore` CLI backed by your operating system keychain:

```sh
keystore list                 # show the keys you have
keystore generate seed        # mint a new seed
keystore generate root --seed <id>     # derive an HD root key
keystore generate account --root <id>  # derive an account
keystore generate falcon --seed <id>   # derive a post-quantum Falcon-1024 key
keystore generate ed25519              # generate a standalone Ed25519 key
keystore sign <id> --message "hi"
keystore algorithms           # show active capabilities
keystore serve                # host the keystore as a local RPC service
keystore clear                # remove everything the CLI created
```

`keystore serve` lets a second process use the keys over a private local socket without ever seeing the secrets. The client engine fulfils the same contract as the in-process keystore, so you can drop it into a provider unchanged.

## Related

- [Keys](/concepts/keys/)
- [Compose a provider](/guides/compose-a-provider/)
