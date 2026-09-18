import type {
  Key,
  KeyStoreExtension,
  KeyStoreState,
  XHDDomainP256KeyData,
} from "@algorandfoundation/keystore-core";
import type { Passkey, PasskeysExtension, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { LogStoreApi, LogStoreExtension } from "@algorandfoundation/logs";
import type { Store } from "@tanstack/store";
import type { PasskeysKeystoreExtensionOptions } from "./types.ts";

/** The key types the bridge turns into passkeys. */
const PASSKEY_KEY_TYPES = new Set(["hd-derived-p256", "xhd-derived-p256"]);

/**
 * The passkey credential id for a key: the key's id in URL-safe base64
 * form (WebAuthn credential ids are base64url), matching how the
 * credential providers derived from these keys report them.
 */
const credentialIdForKey = (key: Key): string =>
  key.id.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Whether a keystore key is a derived P256 domain key with public material. */
const isPasskeyKey = (key: Key): boolean =>
  PASSKEY_KEY_TYPES.has(key.type) && key.publicKey !== undefined;

/**
 * Extension that bridges the passkeys store and keystore.
 *
 * It automatically populates the passkeys store with passkeys backed by
 * the keystore's derived P256 domain keys (`hd-derived-p256` /
 * `xhd-derived-p256`, the keys `deriveDomainKey` mints for WebAuthn
 * credentials), and keeps both stores in sync in BOTH directions:
 *
 * - keystore → passkeys: adding/removing/updating a domain key
 *   adds/removes/refreshes its passkey record (public fields only; the
 *   private key never leaves the keystore).
 * - passkeys → keystore: removing a bridge-owned passkey from the
 *   passkeys store removes the backing key from the keystore. The
 *   propagation runs over a **store observer** (no hook wiring) and is
 *   echo-guarded, so keystore-initiated removals do not loop back.
 *
 * The bridge is platform-neutral: native credential deletion is the
 * react-native feeder's concern (it observes the same store), never
 * imported here.
 *
 * @param provider - The host provider; must already carry `passkey.store`
 *   (`WithPasskeys`) and `key.store` (a keystore extension), and may carry
 *   a `log` extension.
 * @param options - {@link PasskeysKeystoreExtensionOptions}.
 *   `options.passkeys.store` and `options.keystore.store` are required;
 *   `options.passkeys.keystore.autoPopulate` defaults to `true`.
 * @returns An empty surface: the bridge contributes no API of its own, it
 *   only wires the two stores together.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithKeyStore, WithPasskeys, WithPasskeysKeystore]);
 * const provider = new MyProvider(config, {
 *   keystore: { store: keyStore, hooks: keyStoreHooks },
 *   passkeys: { store: passkeysStore, keystore: { autoPopulate: true } },
 * });
 * ```
 */
export const WithPasskeysKeystore: Extension<unknown> = (
  provider: KeyStoreExtension & PasskeysExtension & Partial<LogStoreExtension>,
  options: PasskeysKeystoreExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.passkey) {
    throw new Error(
      "PasskeysKeystore extension requires WithPasskeys extension to be present on the provider.",
    );
  }
  if (!provider.key) {
    throw new Error(
      "PasskeysKeystore extension requires WithKeyStore extension to be present on the provider.",
    );
  }

  const log: LogStoreApi | undefined = provider.log;

  const keyStore: Store<KeyStoreState> = options.keystore.store;
  const passkeysStore: Store<PasskeysState> = options.passkeys.store;
  const { autoPopulate = true } = options.passkeys.keystore ?? {};

  const keys: Key[] = [];

  /** Bridge-owned records: credential id → the backing keystore key id. */
  const bridged = new Map<string, string>();

  /**
   * Creates a passkey record from a keystore key. Public fields only:
   * the credential id (base64url of the key id), a display name
   * (`metadata.label`, falling back to `userHandle@origin`), the public
   * key, the algorithm, and the domain metadata the derivation recorded.
   */
  const createPasskeyFromKey = (key: Key): Passkey => {
    const metadata = (key.metadata ?? {}) as Partial<XHDDomainP256KeyData["metadata"]> & {
      label?: unknown;
      createdAt?: unknown;
    };
    const userHandle = typeof metadata.userHandle === "string" ? metadata.userHandle : undefined;
    const origin = typeof metadata.origin === "string" ? metadata.origin : undefined;
    const label =
      typeof metadata.label === "string" && metadata.label.length > 0 ? metadata.label : undefined;
    const name = label ?? `${userHandle ?? "Unnamed User"}@${origin ?? "Unnamed Origin"}`;

    const passkey: Passkey = {
      credentialId: credentialIdForKey(key),
      name,
      algorithm: typeof key.algorithm === "string" && key.algorithm ? key.algorithm : "P256",
      metadata: {
        ...key.metadata,
        keyId: key.id,
        keyType: key.type,
      },
    };
    if (key.publicKey) passkey.publicKey = key.publicKey;
    if (origin !== undefined) passkey.origin = origin;
    if (userHandle !== undefined) passkey.userHandle = userHandle;
    if (typeof metadata.parentKeyId === "string") passkey.parentKeyId = metadata.parentKeyId;
    if (typeof metadata.createdAt === "number") passkey.createdAt = metadata.createdAt;
    return passkey;
  };

  // Reverse observer: a bridge-owned passkey removed from the passkeys
  // store (UI removal, clear) removes the backing keystore key. The
  // credential id leaves `bridged` BEFORE the keystore call, so the
  // keystore subscription's own removal pass (which drops ids from
  // `bridged` before it removes records) never echoes back here.
  passkeysStore.subscribe(() => {
    const present = new Set(passkeysStore.state.passkeys.map((passkey) => passkey.credentialId));
    for (const [credentialId, keyId] of bridged) {
      if (present.has(credentialId)) continue;
      bridged.delete(credentialId);
      log?.info(
        `removing keystore key ${keyId} for removed passkey ${credentialId}`,
        {},
        "PasskeysKeystore",
      );
      void provider.key.store.remove(keyId).catch((error: unknown) => {
        log?.error(
          `Failed to remove key ${keyId} from keystore: ${String(error)}`,
          {},
          "PasskeysKeystore",
        );
      });
    }
  });

  // Initial population if enabled
  if (autoPopulate) {
    let isProcessing = false;
    let nextKeys: Key[] | null = null;

    const processUpdates = async (newKeys: Key[]): Promise<void> => {
      log?.info(
        `[PasskeysKeystore] processUpdates called with ${newKeys.length} keys. Current status: ${keyStore.state.status}`,
      );
      if (isProcessing) {
        log?.info("[PasskeysKeystore] already processing, queueing next update");
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

        // Find updated keys (metadata change drives a record refresh)
        const updatedKeys = newKeys.filter((newKey) => {
          const existing = keys.find((k) => k.id === newKey.id);
          return existing && JSON.stringify(existing.metadata) !== JSON.stringify(newKey.metadata);
        });

        log?.info(
          `[PasskeysKeystore] processUpdates: ${newKeys.length} total, ${addedKeys.length} added, ${removedKeys.length} removed, ${updatedKeys.length} updated`,
        );

        if (addedKeys.length === 0 && removedKeys.length === 0 && updatedKeys.length === 0) {
          log?.info("[PasskeysKeystore] No changes to process");
          return;
        }

        // Update the local cache of keys BEFORE processing to ensure consistency
        keys.length = 0;
        newKeys.forEach((k) => keys.push(k));

        // Remove passkeys for removed keys
        for (const k of removedKeys) {
          if (!PASSKEY_KEY_TYPES.has(k.type)) continue;
          const credentialId = credentialIdForKey(k);
          const record = passkeysStore.state.passkeys.find(
            (passkey) => passkey.credentialId === credentialId,
          );
          if (record && record.metadata?.keyId !== k.id) continue;
          log?.info(`Removing passkey for key ${k.id}-${k.type}...`);
          // Drop the ownership FIRST so the reverse observer treats this
          // removal as keystore-initiated (no echo back into the keystore).
          bridged.delete(credentialId);
          if (record) {
            await provider.passkey.store.removePasskey(credentialId);
          }
        }

        // Add passkeys for added keys
        for (const k of addedKeys) {
          if (!PASSKEY_KEY_TYPES.has(k.type)) continue;
          if (!k.publicKey) {
            log?.warn(
              `[PasskeysKeystore] key ${k.id} has no public key; skipping`,
              {},
              "PasskeysKeystore",
            );
            continue;
          }
          log?.info(`Adding passkey for key ${k.id}-${k.type}...`);
          const passkey = createPasskeyFromKey(k);
          bridged.set(passkey.credentialId, k.id);
          await provider.passkey.store.addPasskey(passkey);
        }

        // Refresh passkeys for updated keys
        for (const k of updatedKeys) {
          if (!isPasskeyKey(k)) continue;
          log?.info(`Refreshing passkey for updated key ${k.id}...`);
          const passkey = createPasskeyFromKey(k);
          bridged.set(passkey.credentialId, k.id);
          await provider.passkey.store.addPasskey(passkey);
        }
      } finally {
        isProcessing = false;
        if (nextKeys) {
          const k = nextKeys;
          nextKeys = null;
          await processUpdates(k);
        }
      }
    };

    void processUpdates(keyStore.state.keys as unknown as Key[]);

    keyStore.subscribe(() => {
      const state = keyStore.state;
      log?.info(
        `[PasskeysKeystore] Keystore subscriber fired. Status: ${state.status}, Keys: ${state.keys.length}`,
      );
      if (state.status !== "ready" && state.status !== "idle") {
        log?.info(`[PasskeysKeystore] Ignoring status: ${state.status}`);
        return;
      }
      void processUpdates(state.keys as unknown as Key[]);
    });
  }

  return {};
};
