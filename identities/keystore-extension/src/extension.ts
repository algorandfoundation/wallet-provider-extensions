import { base58 } from "@scure/base";
import type { Key, KeyStoreState } from "@algorandfoundation/keystore-core";
import { generateDidKey, generateDidDocument } from "@algorandfoundation/identities-store";
import type {
  Identity,
  IdentityStoreState,
  DIDDocument,
} from "@algorandfoundation/identities-store";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import { decodeAddress, toBase64URL } from "./utils.ts";
import type { IdentitiesKeystoreExtension, IdentitiesKeystoreExtensionOptions } from "./types.ts";

/**
 * Resolve the seed id for a given key by walking the parent chain.
 *
 * - For a derived key (`hd-derived-*`/`xhd-derived-*`), `metadata.parentKeyId`
 *   points at the root key, whose `metadata.rootKeyId` is the seed id.
 * - For a root key, `metadata.rootKeyId` is the seed id directly.
 * - For a seed itself, the seed id is the key's own id.
 */
const getSeedIdForKey = (key: Key | undefined, allKeys: Key[]): string | undefined => {
  if (!key) return undefined;
  // `seed` is the canonical seed type; `hd-seed` is kept for backwards compatibility.
  if (key.type === "seed" || key.type === "hd-seed") return key.id;
  if (key.type === "hd-root-key") {
    // Root keys may be linked to their seed via `rootKeyId` or `parentKeyId`;
    // fall back to the root key's own id when neither is present.
    return (
      (key.metadata?.rootKeyId as string | undefined) ??
      (key.metadata?.parentKeyId as string | undefined) ??
      key.id
    );
  }
  const parentId = key.metadata?.parentKeyId as string | undefined;
  if (!parentId) return undefined;
  const parent = allKeys.find((k) => k.id === parentId);
  if (!parent) return parentId;
  return getSeedIdForKey(parent, allKeys);
};

/** BIP44 coin type for Algorand accounts (SLIP-0044). */
const ALGORAND_COIN_TYPE = 283;

/**
 * Builds the BIP44 path for a key context, mirroring `GetBIP44PathFromContext`
 * in `@algorandfoundation/xhd-wallet-api`:
 *
 * - context 0 (Address):  `m/44'/283'/<account>'/0/<index>`
 * - context 1 (Identity): `m/44'/0'/<account>'/0/<index>`
 *
 * `account`/`index` default to `0` when the DID document omits them.
 */
const getBip44Path = (context: number | undefined, account = 0, index = 0): string => {
  const coinType = context === 1 ? 0 : ALGORAND_COIN_TYPE;
  return `m/44'/${coinType}'/${account}'/0/${index}`;
};

/**
 * Maps the `derivation` value carried by a DID document onto the keystore's
 * derivation `mode`: `32` is Khovratovich (`"standard"`), everything else —
 * including the `9` these documents normally carry — is Peikert.
 */
const getDerivationMode = (derivation: unknown): "standard" | "peikert" =>
  derivation === 32 ? "standard" : "peikert";

/**
 * Metadata fields the keystore engine owns on a derived key record. They are
 * recomputed by `deriveFromSeed`/`deriveDomainKey` for the keystore we restore
 * INTO — e.g. `parentKeyId` must point at this device's root key, not at the
 * root key of the wallet the backup was taken from — so the values carried by
 * the DID document must never be forwarded.
 *
 * `type`/`keyType` are dropped as well: the record's real `type` is decided by
 * the derivation call, the document's copy is only a hint used to pick it.
 */
const engineOwnedMetadata = [
  "storage",
  "parentKeyId",
  "path",
  "bip44Path",
  "derivationType",
  "type",
  "keyType",
];

/**
 * Strips the engine-owned fields from DID document metadata so the restored
 * record keeps the descriptor the document carried (`context`, `account`,
 * `index`, `derivation`, …) while the keystore stays authoritative about the
 * derivation coordinates it just computed.
 */
const toRestoredMetadata = (
  metadata: Record<string, any>,
  omit: string[] = [],
): Record<string, any> => {
  const restored: Record<string, any> = { ...metadata };
  for (const field of [...engineOwnedMetadata, ...omit]) {
    delete restored[field];
  }
  return restored;
};

/**
 * Extension that bridges the identity store and keystore.
 *
 * It automatically populates the identity store with identities derived from keys
 * in the keystore with context 1, providing a sign method that leverages the keystore backend.
 *
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The identities keystore extension.
 *
 * @example
 * ```typescript
 * const provider = Provider.withExtensions([WithIdentityStore, WithKeyStore, WithIdentitiesKeystore]);
 * ```
 */
export const WithIdentitiesKeystore: Extension<IdentitiesKeystoreExtension> = (
  provider: any,
  options: IdentitiesKeystoreExtensionOptions,
) => {
  // Ensure dependencies are present
  if (!provider.identity) {
    throw new Error(
      "IdentitiesKeystore extension requires WithIdentityStore extension to be present on the provider.",
    );
  }
  if (!provider.key) {
    throw new Error(
      "IdentitiesKeystore extension requires WithKeyStore extension to be present on the provider.",
    );
  }

  const keyStore: Store<KeyStoreState> = options.keystore.store;
  const identityStore: Store<IdentityStoreState> = options.identities.store;
  const { autoPopulate = true } = options.identities.keystore ?? {};

  /**
   * Recreates the keystore state (derived keys) based on the provided DID Document.
   *
   * Every key in the document is a DERIVED key, so it is recreated through the
   * keystore's derivation API (`deriveFromSeed` for BIP32-Ed25519 children,
   * `deriveDomainKey` for deterministic-P256 passkeys) and never through
   * `generate`, which only mints fresh, non-derived key material: a
   * `generate({ type: "hd-derived-ed25519", algorithm: "EdDSA" })` call falls
   * through the engine straight to the host WebCrypto, which rejects it with
   * `'subtle.generateKey()' is not implemented for EdDSA` (React Native) — and
   * even where it does not throw it would mint an unrelated key instead of
   * re-deriving the backed-up one.
   */
  const restoreFromDidDocument = async (doc: DIDDocument) => {
    const getLatestKeys = () => (keyStore.state.keys as unknown as Key[]) ?? [];
    const rootKeys = getLatestKeys().filter((k) => k.type === "hd-root-key");

    if (rootKeys.length === 0) {
      throw new Error("No root key found in keystore. Recovery phrase must be imported first.");
    }

    // The XHD (BIP32-Ed25519) root parents every ed25519 child. The
    // `pbkdf2-p256` root is the deterministic-P256 "main key" — a different
    // root that can only parent domain (passkey) keys — so the two are picked
    // apart here instead of taking the first `hd-root-key` we come across.
    const rootKey = rootKeys.find((k) => k.metadata?.scheme !== "pbkdf2-p256");
    const mainKey = rootKeys.find((k) => k.metadata?.scheme === "pbkdf2-p256");

    // 1. Verify that the root key matches the backup document by re-deriving an account key
    const verificationVm = doc.verificationMethod.find(
      (vm) =>
        vm.metadata &&
        vm.metadata.context === 0 &&
        (vm.metadata.type === "hd-derived-ed25519" || !vm.metadata.type),
    );

    if (verificationVm) {
      if (!rootKey) {
        throw new Error(
          "No XHD root key found in keystore. Recovery phrase must be imported first.",
        );
      }
      if (typeof provider.key.store.deriveFromSeed !== "function") {
        throw new Error(
          "The keystore backend does not support HD derivation (deriveFromSeed), so the backup cannot be verified.",
        );
      }

      const { account, index, derivation } = verificationVm.metadata ?? {};
      const keyId = await provider.key.store.deriveFromSeed(
        rootKey.id,
        getBip44Path(0, account, index),
        {
          algorithm: "EdDSA",
          mode: getDerivationMode(derivation),
          metadata: toRestoredMetadata(verificationVm.metadata ?? {}),
        },
      );

      const decoded = base58.decode(verificationVm.publicKeyMultibase.slice(1));
      const expectedPublicKey = decoded.slice(2); // Remove multicodec prefix [0xed, 0x01]

      const derivedKey = (keyStore.state.keys as unknown as Key[]).find((k) => k.id === keyId);
      if (derivedKey?.publicKey) {
        const actualPublicKey = derivedKey.publicKey;
        const matches =
          actualPublicKey.length === expectedPublicKey.length &&
          actualPublicKey.every((v, i) => v === expectedPublicKey[i]);

        if (!matches) {
          throw new Error(
            "The recovery phrase does not match the backup file. Verification failed.",
          );
        }
      }
    }

    const processedDerivations = new Set<string>();

    const restoreKey = async (id: string, metadata: any) => {
      if (!metadata || (metadata.context === undefined && metadata.origin === undefined)) {
        return;
      }

      const {
        context,
        account,
        index,
        derivation,
        origin,
        userHandle,
        counter,
        keyType: metadataKeyType,
        type,
      } = metadata;

      // DID documents generated by this extension store the keystore key type
      // under `metadata.keyType`; fall back to `metadata.type` for older docs.
      const keyType = metadataKeyType || type || "hd-derived-ed25519";
      // Passkeys are the deterministic-P256 entries: either they say so via
      // their key type, or they are recognisable by the `origin` they carry.
      const isP256 =
        keyType === "xhd-derived-p256" ||
        keyType === "hd-derived-p256" ||
        typeof origin === "string";

      const keyId = id.includes("#") ? id.split("#").pop() : id;

      if (!keyId) {
        return;
      }

      const derivationKey = JSON.stringify({
        keyType,
        context,
        account,
        index,
        derivation,
        origin,
        userHandle,
        counter,
      });
      if (processedDerivations.has(derivationKey)) return;
      processedDerivations.add(derivationKey);

      const currentKeys = getLatestKeys();
      const exists = currentKeys.some(
        (k) =>
          k.id === keyId ||
          (k.type === keyType &&
            k.metadata?.context === context &&
            k.metadata?.account === account &&
            k.metadata?.index === index &&
            k.metadata?.derivation === derivation &&
            k.metadata?.origin === origin &&
            k.metadata?.userHandle === userHandle &&
            k.metadata?.counter === counter),
      );

      let processedUserHandle = userHandle;
      if (typeof userHandle === "string" && userHandle.length === 58) {
        try {
          const bytes = decodeAddress(userHandle).publicKey;
          processedUserHandle = toBase64URL(bytes);
        } catch {
          // Not an address, keep as is
        }
      }

      if (exists) {
        return;
      }

      // Re-derive rather than generate: `generate` only mints fresh key
      // material and, for a `hd-derived-*` type, reaches the host WebCrypto
      // which throws `'subtle.generateKey()' is not implemented for EdDSA`.
      // A missing derivation API is skipped (like any other failure below)
      // instead of silently falling back to `generate`.
      if (isP256) {
        if (
          typeof provider.key.store.deriveDomainKey !== "function" ||
          !mainKey ||
          typeof origin !== "string" ||
          typeof processedUserHandle !== "string"
        ) {
          return;
        }

        try {
          await provider.key.store.deriveDomainKey(mainKey.id, {
            algorithm: "P256",
            id: keyId,
            origin,
            userHandle: processedUserHandle,
            counter: counter ?? 0,
            metadata: toRestoredMetadata(metadata, ["origin", "userHandle", "counter", "scheme"]),
          });
        } catch {
          // Continue with other keys even if one fails
        }
        return;
      }

      if (typeof provider.key.store.deriveFromSeed !== "function" || !rootKey) {
        return;
      }

      try {
        await provider.key.store.deriveFromSeed(rootKey.id, getBip44Path(context, account, index), {
          algorithm: "EdDSA",
          id: keyId,
          mode: getDerivationMode(derivation),
          metadata: toRestoredMetadata(metadata),
        });
      } catch {
        // Continue with other keys even if one fails
      }
    };

    const sortedMethods = [...doc.verificationMethod].sort((a, b) => {
      const contextA = a.metadata?.context;
      const contextB = b.metadata?.context;
      if (contextA === 1 && contextB !== 1) return 1;
      if (contextA !== 1 && contextB === 1) return -1;
      return 0;
    });

    for (const vm of sortedMethods) {
      await restoreKey(vm.id, vm.metadata);
    }
  };

  const localKeys: Key[] = [];

  /**
   * Creates an identity object for a given key ID and address.
   */
  const createKeyIdentity = (
    keyId: string,
    address: string,
    did: string,
    publicKey: Uint8Array,
  ): Identity => {
    const currentKey = localKeys.find((rk) => rk.id === keyId);

    // Anchor the identity to the seed: every derived key (ed25519 or p256)
    // descending from the same seed is part of this identity's hierarchy.
    // P256 keys (including `xhd-derived-p256` with `metadata.origin`, i.e. passkeys)
    // are surfaced as JsonWebKey2020 verification methods alongside the ed25519 ones.
    const seedId = getSeedIdForKey(currentKey, localKeys);
    const additionalKeys: {
      id: string;
      publicKey: Uint8Array;
      type: string;
      algorithm?: string;
      metadata?: Record<string, any>;
    }[] = localKeys
      .filter((k) => {
        if (!k.publicKey || k.id === keyId) return false;
        if (
          k.type !== "hd-derived-ed25519" &&
          k.type !== "hd-derived-p256" &&
          k.type !== "xhd-derived-p256"
        ) {
          return false;
        }
        return seedId !== undefined && getSeedIdForKey(k, localKeys) === seedId;
      })
      .map((k) => {
        const isP256 = k.type === "hd-derived-p256" || k.type === "xhd-derived-p256";
        return {
          id: `${did}#${k.id}`,
          publicKey: k.publicKey!,
          type: isP256 ? "JsonWebKey2020" : "Ed25519VerificationKey2020",
          algorithm: isP256 ? "P256" : "EdDSA",
          metadata: { ...k.metadata, keyType: k.type },
        };
      });

    const didDocument = generateDidDocument(
      did,
      publicKey,
      additionalKeys,
      [],
      currentKey?.metadata,
      keyId,
    );

    return {
      address,
      did,
      didDocument,
      type: "did:key",
      metadata: { keyId },
      sign: async (txns: Uint8Array[]) => {
        const signedTxns: Uint8Array[] = [];
        for (const txn of txns) {
          const signed = await provider.key.store.sign(keyId, txn);
          signedTxns.push(signed);
        }
        return signedTxns;
      },
    };
  };

  if (autoPopulate) {
    let isProcessing = false;
    let nextKeys: Key[] | null = null;
    const processUpdates = async (newKeys: Key[]) => {
      if (isProcessing) {
        nextKeys = newKeys;
        return;
      }
      isProcessing = true;
      try {
        nextKeys = null;

        const addedKeys = newKeys.filter(
          (newKey) => !localKeys.some((existingKey) => existingKey.id === newKey.id),
        );

        const removedKeys = localKeys.filter(
          (existingKey) => !newKeys.some((newKey) => newKey.id === existingKey.id),
        );

        // An identity's DID document hierarchy includes every derived key
        // descending from the same seed. So whenever ANY derived key changes
        // (added/removed/metadata-changed), every identity rooted in the
        // affected seed must be re-rendered.
        const isDerived = (k: Key) =>
          k.type === "hd-derived-ed25519" ||
          k.type === "hd-derived-p256" ||
          k.type === "xhd-derived-p256";

        const updatedKeys = newKeys.filter((nk) => {
          const existing = localKeys.find((k) => k.id === nk.id);
          if (!existing) return false;
          return JSON.stringify(existing.metadata) !== JSON.stringify(nk.metadata);
        });

        const hierarchyChanged =
          addedKeys.some(isDerived) || removedKeys.some(isDerived) || updatedKeys.some(isDerived);

        if (addedKeys.length === 0 && removedKeys.length === 0 && updatedKeys.length === 0) {
          return;
        }

        localKeys.length = 0;
        newKeys.forEach((k) => localKeys.push(k));

        for (const k of removedKeys) {
          if (k.type === "hd-derived-ed25519" && k.publicKey) {
            const address = generateDidKey(k.publicKey);
            const identity = identityStore.state.identities.find((i) => i.address === address);
            if (identity && identity.metadata?.keyId === k.id) {
              await provider.identity.store.removeIdentity(address);
            }
          }
        }

        for (const k of addedKeys) {
          if (k.type === "hd-derived-ed25519" && k.publicKey && k.metadata?.context === 1) {
            const did = generateDidKey(k.publicKey);
            const address = did;

            if (!identityStore.state.identities.some((i) => i.address === address)) {
              await provider.identity.store.addIdentity(
                createKeyIdentity(k.id, address, did, k.publicKey),
              );
            }
          }
        }

        for (const k of updatedKeys) {
          if (k.type === "hd-derived-ed25519" && k.publicKey && k.metadata?.context === 1) {
            const did = generateDidKey(k.publicKey);
            const address = did;

            const identity = identityStore.state.identities.find((i) => i.address === address);
            if (identity) {
              const newIdentity = createKeyIdentity(k.id, address, did, k.publicKey);
              await provider.identity.store.updateDidDocument(address, newIdentity.didDocument!);
            }
          }
        }

        // If the seed hierarchy was touched but the identity key itself didn't
        // change, still refresh every existing identity so its derived-key list
        // stays in sync (e.g. a new account key was added under the same seed).
        if (hierarchyChanged) {
          for (const identity of identityStore.state.identities) {
            const idKeyId = identity.metadata?.keyId as string | undefined;
            if (!idKeyId || !identity.did) continue;
            const idKey = localKeys.find((k) => k.id === idKeyId);
            if (!idKey || !idKey.publicKey) continue;
            // Skip if we already added/updated this identity in this tick.
            const alreadyHandled =
              addedKeys.some((k) => k.id === idKeyId) || updatedKeys.some((k) => k.id === idKeyId);
            if (alreadyHandled) continue;
            const refreshed = createKeyIdentity(
              idKeyId,
              identity.address,
              identity.did,
              idKey.publicKey,
            );
            await provider.identity.store.updateDidDocument(
              identity.address,
              refreshed.didDocument!,
            );
          }
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

    processUpdates(keyStore.state.keys as unknown as Key[]);

    keyStore.subscribe((state) => {
      if (state.status !== "ready" && state.status !== "idle") {
        return;
      }
      processUpdates(state.keys as unknown as Key[]);
    });
  }

  // Merge into the existing identity.store so we don't clobber the API
  // (add/remove/get/clear/updateDidDocument) contributed by WithIdentityStore.
  return {
    identity: {
      store: Object.assign(provider.identity.store ?? {}, {
        restoreFromDidDocument,
      }),
    },
  } as unknown as IdentitiesKeystoreExtension;
};
