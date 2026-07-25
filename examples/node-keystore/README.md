# Node Keystore Example

A minimal, runnable Node.js example of the server keystore extension for the
Wallet Provider. Secret material is stored in your operating-system keychain and
all UI-safe metadata in a sealed file (`~/.algorand-keystore/…`), via
`@algorandfoundation/keystore-node`.

## What it demonstrates

- **Provider composition** — composing a `Provider` with the `WithKeyStore`
  extension and reading its reactive `keys` / `algorithms` / `status`.
- **Capability discovery** — listing the active algorithms, tagged by source
  (host `SubtleCrypto` vs. composable shim add-ons).
- **Key lifecycle** — minting a BIP39 seed, deriving an HD (BIP32-Ed25519) root
  key, deriving an Ed25519 account, then signing and verifying a message.

## Running the example

From the repository root:

```bash
pnpm install
pnpm --filter node-keystore-example start
```

> The example writes to your real OS keychain. Run `keystore clear` (the CLI
> shipped by `@algorandfoundation/keystore-node`) to remove the keys it creates.

## The `keystore` CLI

The same engine is exposed as a terminal CLI by `@algorandfoundation/keystore-node`:

```bash
keystore generate seed                 # mint a BIP39 seed (prints the phrase once)
keystore generate root --seed <id>     # derive an HD root key
keystore generate account --root <id>  # derive the next Ed25519 account key
keystore generate falcon --seed <id>   # derive a post-quantum Falcon-1024 key
keystore list                          # list key metadata
keystore sign <id> --message "hi"      # sign a UTF-8 message (prints hex)
keystore verify <id> --message "hi" --signature <hex>
keystore algorithms                    # list active cryptographic capabilities
```

## Type checking

```bash
pnpm --filter node-keystore-example typecheck
```
