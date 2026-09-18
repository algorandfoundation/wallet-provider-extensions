import {
  type Account,
  type AccountStoreExtension,
  type AccountStoreState,
  type WalletKey,
  addAccount,
  removeAccount,
} from "@algorandfoundation/accounts-core";
import type {
  Key,
  KeyStoreExtension,
  KeyStoreState,
  XHDDerivedKeyData,
} from "@algorandfoundation/keystore-core";
import { base64 } from "@scure/base";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { LogStoreApi, LogStoreExtension } from "@algorandfoundation/logs";
import type { Store } from "@tanstack/store";
import type { AccountsKeystoreExtensionOptions, KeystoreAccount } from "./types.ts";

/** The key types the bridge turns into accounts. */
const ACCOUNT_KEY_TYPES = new Set(["hd-derived-ed25519", "ed25519", "falcon-1024"]);

/**
 * The store address for an account-producing key: the base64 of the key's
 * public key, keyed like the rest of the store (the wire seams normalize to
 * canonical chain addresses). This bridge is a reference example; concrete
 * chain addressing (e.g. Algorand addresses, canonical PQ digests) belongs to
 * chain-specific extensions such as the algorand-accounts extension.
 */
const addressForKey = (key: Key): string | undefined =>
  key.publicKey ? base64.encode(key.publicKey) : undefined;

/**
 * Type guard narrowing an {@link Account} to a {@link KeystoreAccount}.
 *
 * @param account - The account to test.
 * @returns Whether the account was populated by this bridge.
 *
 * @example
 * ```typescript
 * const signer = provider.accounts.find(isKeystoreAccount);
 * ```
 */
export function isKeystoreAccount(account: Account): account is KeystoreAccount {
  return account.type === "keystore-account";
}

/**
 * Extension that bridges the account store and keystore.
 *
 * It automatically populates the account store with accounts derived from keys
 * in the keystore, providing a sign method that leverages the keystore backend.
 * The bridge contributes no surface of its own (it writes into the shared
 * accounts store), so it returns an empty object.
 *
 * @param provider - The host provider; must already carry `WithAccounts` and a
 *   keystore extension (`provider.account`, `provider.key`). Reports through
 *   `provider.log` when present.
 * @param options - {@link AccountsKeystoreExtensionOptions};
 *   `options.accounts.store` and `options.keystore.store` are required.
 * @returns An empty surface.
 * @throws When `provider.account`, `provider.key` or a wallet key is missing.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithAccounts, WithKeyStore, WithAccountsKeystore]);
 * const provider = new MyProvider(
 *   { id: "my-provider", name: "My Provider" },
 *   {
 *     accounts: { store: accountStore, keystore: { autoPopulate: true } },
 *     keystore: { store: keyStore, hooks: keyStoreHooks },
 *   },
 * );
 * ```
 */
export const WithAccountsKeystore: Extension<unknown> = (
  provider: KeyStoreExtension & AccountStoreExtension<KeystoreAccount> & LogStoreExtension,
  options: AccountsKeystoreExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.account) {
    throw new Error(
      "AccountsKeystore extension requires WithAccounts extension to be present on the provider.",
    );
  }
  if (!provider.key) {
    throw new Error(
      "AccountsKeystore extension requires WithKeyStore extension to be present on the provider.",
    );
  }

  const log: LogStoreApi | undefined = provider.log;

  const keyStore: Store<KeyStoreState> = options.keystore.store;
  const accountStore: Store<AccountStoreState<KeystoreAccount>> = options.accounts.store;
  const { autoPopulate = true } = options.accounts.keystore ?? {};

  // Accounts are written under a wallet key, mirroring use-wallet's
  // per-wallet partitioning. Defaults to the provider's id, the same key
  // WithAccounts scopes to.
  const walletKey: WalletKey | undefined =
    options.accounts.walletKey ?? (provider as { id?: string }).id;
  if (!walletKey) {
    throw new Error(
      "AccountsKeystore extension requires a wallet key (options.accounts.walletKey or provider.id).",
    );
  }

  const storedAccounts = (): KeystoreAccount[] =>
    accountStore.state.wallets[walletKey]?.accounts ?? [];

  const keys: Key[] = [];

  /**
   * Resolves the originating seed's `scheme` (e.g. `"bip39"`, `"algo25"`) for a
   * given key by walking the parent chain in the current `keys` cache:
   *
   * - `ed25519` → direct parent is the seed.
   * - `hd-derived-ed25519` → parent is an `hd-root-key` whose
   *   `metadata.parentKeyId` (or legacy `rootKeyId`) points at the seed.
   *
   * Returns `undefined` when any link is missing or the seed has no `scheme`.
   */
  const resolveSeedScheme = (key: Key, allKeys: Key[]): string | undefined => {
    const parentId = (key as { metadata?: { parentKeyId?: string } })?.metadata?.parentKeyId;
    if (!parentId) return undefined;
    const parent = allKeys.find((k) => k.id === parentId);
    if (!parent) return undefined;
    let seed: Key | undefined;
    if (parent.type === "seed" || parent.type === "hd-seed") {
      seed = parent;
    } else if (parent.type === "hd-root-key") {
      const seedId =
        (parent as { metadata?: { parentKeyId?: string; rootKeyId?: string } })?.metadata
          ?.parentKeyId ?? (parent as { metadata?: { rootKeyId?: string } })?.metadata?.rootKeyId;
      if (seedId) seed = allKeys.find((k) => k.id === seedId);
    }
    const scheme = (seed as { metadata?: { scheme?: unknown } })?.metadata?.scheme;
    return typeof scheme === "string" ? scheme : undefined;
  };

  /**
   * Synthesizes a display name for a key-derived account: the key's
   * `metadata.label` when present, otherwise a truncated address.
   */
  const synthesizeName = (key: Key, address: string): string => {
    const label = (key as { metadata?: { label?: unknown } })?.metadata?.label;
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  };

  /**
   * Creates an account object for a given key and address. The backing key's
   * type travels as `metadata.keyType` so consumers can label the account
   * (HD vs standalone ed25519 vs post-quantum Falcon).
   */
  const createKeyAccount = (
    key: Key,
    address: string,
    parentKeyId?: string,
    seedScheme?: string,
  ): KeystoreAccount => ({
    name: synthesizeName(key, address),
    address,
    type: "keystore-account",
    assets: [],
    metadata: {
      keyId: key.id,
      keyType: key.type,
      parentKeyId,
      ...(seedScheme !== undefined ? { seedScheme } : {}),
    },
    balance: BigInt(0),
    // Deferred (post-1.0.0): a first-class algosdk `TransactionSigner` surface.
    // The 1.0.0 contract is the raw `sign(txns)` below; consumers that need an
    // algosdk `TransactionSigner` wrap it (see the use-wallet adapter in
    // `examples/use-wallet-client`). Revisit once downstream signer
    // requirements (multisig, rekey, group ergonomics) settle.
    sign: async (txns: Uint8Array[]) => {
      // Sign each transaction using the keystore
      const signedTxns: Uint8Array[] = [];
      for (const txn of txns) {
        const signed = await provider.key.store.sign(key.id, txn);
        signedTxns.push(signed);
      }
      return signedTxns;
    },
  });

  // Initial population if enabled
  if (autoPopulate) {
    let isProcessing = false;
    let nextKeys: Key[] | null = null;

    const processUpdates = (newKeys: Key[]) => {
      log?.info(
        `[AccountsKeystore] processUpdates called with ${newKeys.length} keys. Current status: ${keyStore.state.status}`,
      );
      if (isProcessing) {
        log?.info("[AccountsKeystore] already processing, queueing next update");
        nextKeys = newKeys;
        return;
      }
      isProcessing = true;
      try {
        nextKeys = null;

        // Find added keys
        const addedKeys = newKeys.filter(
          (newKey) => !keys.some((existingKey) => existingKey.id === newKey.id),
        );

        // Find removed keys
        const removedKeys = keys.filter(
          (existingKey) => !newKeys.some((newKey) => newKey.id === existingKey.id),
        );

        log?.info(
          `[AccountsKeystore] processUpdates: ${newKeys.length} total, ${addedKeys.length} added, ${removedKeys.length} removed`,
        );

        if (addedKeys.length === 0 && removedKeys.length === 0) {
          log?.info("[AccountsKeystore] No changes to process");
          return;
        }

        // Update the local cache of keys BEFORE processing to ensure consistency
        keys.length = 0;
        newKeys.forEach((k) => keys.push(k));

        // Remove accounts for removed keys
        for (const k of removedKeys) {
          if (ACCOUNT_KEY_TYPES.has(k.type)) {
            const address = addressForKey(k);
            if (!address) continue;
            const account = storedAccounts().find((a) => a.address === address);
            if (account && account.metadata?.keyId === k.id) {
              log?.info(`Removing account for key ${k.id}-${k.type}...`);
              removeAccount({ store: accountStore, walletKey, address });
            }
          }
        }

        // Process only the newly added keys
        for (const k of addedKeys) {
          if (ACCOUNT_KEY_TYPES.has(k.type)) {
            log?.info(`Checking account for key ${k.id}-${k.type}...`);
            const address = addressForKey(k);
            if (!address) continue;
            const parentKeyId = (k as XHDDerivedKeyData)?.metadata?.parentKeyId;

            // Standalone ed25519 and falcon-1024 keys don't have a `context`;
            // only the address-context (0) branch of XHD-derived keys
            // produces accounts.
            const isAddressContext = k.type !== "hd-derived-ed25519" || k.metadata?.context === 0;

            // Skip if the account already exists
            if (!storedAccounts().some((a) => a.address === address) && isAddressContext) {
              log?.info(`Adding account for key ${k.id}-${k.type}...`);
              const seedScheme = resolveSeedScheme(k, newKeys);
              addAccount({
                store: accountStore,
                walletKey,
                account: createKeyAccount(k, address, parentKeyId, seedScheme),
              });
            }
          }
        }
      } finally {
        isProcessing = false;
        if (nextKeys) {
          const k = nextKeys;
          nextKeys = null;
          processUpdates(k);
        }
      }
    };

    processUpdates(keyStore.state.keys as unknown as Key[]);

    keyStore.subscribe((state) => {
      log?.info(
        `[AccountsKeystore] Keystore subscriber fired. Status: ${state.status}, Keys: ${state.keys.length}`,
      );
      if (state.status !== "ready" && state.status !== "idle") {
        log?.info(`[AccountsKeystore] Ignoring status: ${state.status}`);
        return;
      }
      processUpdates(state.keys as unknown as Key[]);
    });
  }

  return {};
};
