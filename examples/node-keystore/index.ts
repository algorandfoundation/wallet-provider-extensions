/**
 * Node Keystore Example.
 *
 * A minimal, runnable Node.js script that wires the Wallet {@link Provider} with
 * the server keystore extension and walks the core key lifecycle: discover the
 * active cryptographic capabilities, mint a BIP39 seed, derive an HD root key
 * and an Ed25519 account, then sign and verify a message.
 *
 * Secret material is stored in your operating-system keychain and all UI-safe
 * metadata in a sealed file (`~/.algorand-keystore/…`) — exactly like any real
 * consumer of `@algorandfoundation/keystore-node`. The same package also ships
 * the `keystore` CLI, which drives this identical engine from the terminal.
 *
 * Run it with:
 * ```sh
 * pnpm --filter node-keystore-example start
 * ```
 */

import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore-node";
import type { Key, KeyStoreCapability, KeyStoreState } from "@algorandfoundation/keystore-node";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/** Reactive state store — the single source of truth for key metadata. */
const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

/** Hook collection for intercepting keystore operations (before/after/error). */
const hooks = new Hook.Collection();

/** The Wallet Provider composed with the Node keystore extension. */
const NodeProvider = Provider.withExtensions([WithKeyStore]);

/** A concrete provider instance backed by the OS keychain engine. */
const provider = new NodeProvider(
  { id: "node-keystore-example", name: "Node Keystore Example" },
  { keystore: { store, hooks } },
);

/** Hex-encodes bytes for readable output. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pretty-prints the active capabilities grouped by source. */
function printCapabilities(algorithms: KeyStoreCapability[]): void {
  console.log("\nActive capabilities:");
  for (const cap of algorithms) {
    console.log(`  [${cap.source}] ${cap.algorithm}`);
  }
}

/** Pretty-prints the stored key metadata. */
function printKeys(keys: Key[]): void {
  console.log("\nStored keys:");
  for (const key of keys) {
    console.log(`  ${key.id}  ${key.type}  ${key.algorithm}`);
  }
}

/** Runs the end-to-end demonstration. */
async function main(): Promise<void> {
  // Wait for the engine to layer its shims and hydrate any existing metadata.
  await provider.key.store.ready;
  printCapabilities(provider.algorithms ?? []);

  // 1. Mint a BIP39 seed and import its bytes (the mnemonic never enters the store).
  const mnemonic = generateMnemonic(wordlist, 256);
  const seed = await mnemonicToSeed(mnemonic);
  const seedId = await provider.key.store.importSeed!(seed, { name: "Wallet Seed" });
  console.log(`\nMnemonic (store safely — shown once):\n  ${mnemonic}`);

  // 2. Derive an HD (BIP32-Ed25519) root key from the seed.
  const rootKeyId = await provider.key.store.generate({
    type: "hd-root-key",
    algorithm: "raw",
    extractable: false,
    keyUsages: ["deriveBits", "deriveKey"],
    params: { parentKeyId: seedId },
  });

  // 3. Derive the first Ed25519 account key from the root along a BIP44 path.
  const accountId = await provider.key.store.deriveFromSeed!(rootKeyId, "m/44'/283'/0'/0/0");

  // 4. Sign and verify a message with the account key.
  const message = new TextEncoder().encode("hello from the node keystore example");
  const signature = await provider.key.store.sign(accountId, message);
  const valid = await provider.key.store.verify(accountId, message, signature);
  console.log(`\nSignature: ${toHex(signature)}`);
  console.log(`Verified:  ${valid}`);

  printKeys(provider.keys);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
