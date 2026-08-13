import {
  type Account,
  type AccountStoreExtension,
  type AccountStoreState,
  addAccount,
  removeAccount,
} from "@algorandfoundation/accounts-store";
import type {
  Key,
  KeyStoreExtension,
  KeyStoreState,
  XHDDerivedKeyData,
} from "@algorandfoundation/keystore-core";
import { base64 } from "@scure/base";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { LogStoreApi, LogStoreExtension } from "@algorandfoundation/log-store";
import type { Store } from "@tanstack/store";
import type { AccountsKeystoreExtensionOptions, KeystoreAccount } from "./types.ts";

export function isKeystoreAccount(account: Account): account is KeystoreAccount {
  return account.type === "keystore-account";
}

/**
 * Extension that bridges the account store and keystore.
 *
 * It automatically populates the account store with accounts derived from keys
 * in the keystore, providing a sign method that leverages the keystore backend.
 */
export const WithAccountsKeystore: Extension<unknown> = (
  provider: KeyStoreExtension & AccountStoreExtension<KeystoreAccount> & LogStoreExtension,
  options: AccountsKeystoreExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.account) {
    throw new Error(
      "AccountsKeystore extension requires WithAccountStore extension to be present on the provider.",
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
   * Creates an account object for a given key ID and address.
   */
  const createKeyAccount = (
    keyId: string,
    address: string,
    parentKeyId?: string,
    seedScheme?: string,
  ): KeystoreAccount => ({
    address,
    type: "keystore-account",
    assets: [],
    metadata: {
      keyId,
      parentKeyId,
      ...(seedScheme !== undefined ? { seedScheme } : {}),
    },
    balance: BigInt(0),
    // TODO: TransactionSigners
    sign: async (txns: Uint8Array[]) => {
      // Sign each transaction using the keystore
      const signedTxns: Uint8Array[] = [];
      for (const txn of txns) {
        const signed = await provider.key.store.sign(keyId, txn);
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
          if ((k.type === "hd-derived-ed25519" || k.type === "ed25519") && k.publicKey) {
            const address = base64.encode(k.publicKey);
            const account = accountStore.state.accounts.find((a) => a.address === address);
            if (account && account.metadata?.keyId === k.id) {
              log?.info(`Removing account for key ${k.id}-${k.type}...`);
              removeAccount<KeystoreAccount>({ store: accountStore, address });
            }
          }
        }

        // Process only the newly added keys
        for (const k of addedKeys) {
          if ((k.type === "hd-derived-ed25519" || k.type === "ed25519") && k.publicKey) {
            log?.info(`Checking account for key ${k.id}-${k.type}...`);
            const address = base64.encode(k.publicKey);
            const parentKeyId = (k as XHDDerivedKeyData)?.metadata?.parentKeyId;

            // Standalone ed25519 keys don't have a `context`; only the
            // address-context (0) branch of XHD-derived keys produces accounts.
            const isAddressContext = k.type === "ed25519" || k.metadata?.context === 0;

            // Skip if the account already exists
            if (
              !accountStore.state.accounts.some((a) => a.address === address) &&
              isAddressContext
            ) {
              log?.info(`Adding account for key ${k.id}-${k.type}...`);
              const seedScheme = resolveSeedScheme(k, newKeys);
              addAccount<KeystoreAccount>({
                store: accountStore,
                account: createKeyAccount(k.id, address, parentKeyId, seedScheme),
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
