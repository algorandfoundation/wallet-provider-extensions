/**
 * Local browser-keystore identities: the "local" half of the demo, next
 * to the remote identities the connected wallet syncs over the connection.
 *
 * One flow is demonstrated: the **identity**, minted as a PAIR of
 * non-extractable keys in the web keystore (see `./keys/types.ts` for
 * the key predicates and the WebCrypto ECDH):
 *
 * - an Ed25519 **signing key**, projected as a `did:key`
 *   {@link LocalIdentity} (DID document included) into the shared
 *   identity store, where it sits side by side with the wallet-synced
 *   remote identities;
 * - a companion X25519 **key-agreement key**, advertised in the DID
 *   document's `keyAgreement` section. WebCrypto limits Ed25519 keys to
 *   `sign`/`verify` (no `deriveKey`/`deriveBits`), and a non-extractable
 *   key can't lend its private material to the did:key birational
 *   conversion, so the agreement runs on this separate X25519 key
 *   instead, INSIDE `SubtleCrypto` (non-extractability blocks export,
 *   not use; see the keystore's `deriveSharedSecret` in
 *   `../keys/connections/encryption.ts`).
 *
 * Encryption itself is derived from the CONNECTED WALLET's identity,
 * not a self-owned key; see `../keys/connections/encryption.ts` /
 * `WalletEncryptionPanel`.
 */

import { generateDidDocument, generateDidKey } from "@algorandfoundation/identities";
import type { Key } from "@algorandfoundation/keystore";
import { keyStore } from "../../stores/keyStore.ts";
import type { DappProvider } from "../provider/provider.ts";
import {
  IDENTITY_CONTEXT,
  isIdentityKey,
  isKeyAgreementKey,
  rawX25519PublicKey,
} from "./keys/types.ts";
import type { LocalIdentity } from "./types.ts";

/**
 * Projects a keystore signing key (plus its optional X25519 companion)
 * into a {@link LocalIdentity}: derives the `did:key` identifier and W3C
 * DID document from the key's public half (advertising the companion in
 * `keyAgreement`), and routes `sign` back through the keystore, so
 * neither private key ever leaves it. Shared by
 * {@link generateLocalIdentity} (freshly minted keys) and
 * {@link rehydrateLocalIdentities} (keys persisted from a previous visit).
 */
function buildLocalIdentity(
  ctx: DappProvider,
  key: Key,
  agreementKey: Key | undefined,
): LocalIdentity {
  const keystore = ctx.key.store;
  if (!key.publicKey) {
    throw new Error("the identity key did not surface a public key");
  }
  const did = generateDidKey(key.publicKey);
  return {
    address: did,
    did,
    didDocument: generateDidDocument(
      did,
      key.publicKey,
      [],
      [],
      { context: IDENTITY_CONTEXT, keyId: key.id },
      undefined,
      agreementKey?.publicKey ? rawX25519PublicKey(agreementKey.publicKey) : undefined,
    ),
    type: "did:key",
    sign: (txns) => Promise.all(txns.map((txn) => keystore.sign(key.id, txn))),
    metadata: { source: "local", keyId: key.id, agreementKeyId: agreementKey?.id },
  };
}

/**
 * Mints a local identity: generates a fresh Ed25519 signing key AND its
 * X25519 key-agreement companion inside the web keystore, derives the
 * `did:key` identifier and W3C DID document from the signing key, with
 * the companion advertised in `keyAgreement`, and records the
 * {@link LocalIdentity} (tagged `metadata.source: "local"`) in the
 * shared identity store. The identity's `sign` routes back through the
 * keystore, so neither private key ever leaves it.
 */
export async function generateLocalIdentity(ctx: DappProvider): Promise<LocalIdentity> {
  const keystore = ctx.key.store;
  const keyId = await keystore.generate({
    type: "ed25519",
    algorithm: "EdDSA",
    extractable: false,
    keyUsages: ["sign", "verify"],
    params: { name: "Identity Key", context: IDENTITY_CONTEXT },
  });
  const key = keyStore.state.keys.find((candidate) => candidate.id === keyId);
  if (!key?.publicKey) {
    throw new Error("the generated identity key did not surface a public key");
  }

  // The agreement companion: WebCrypto won't let the Ed25519 key derive
  // (sign/verify only), so the identity's ECDH half is its own
  // non-extractable X25519 key, linked back via `identityKeyId`.
  const agreementKeyId = await keystore.generate({
    type: "ecc",
    algorithm: "X25519",
    extractable: false,
    keyUsages: ["deriveBits"],
    params: { name: "Key Agreement Key", context: IDENTITY_CONTEXT, identityKeyId: keyId },
  });
  const agreementKey = keyStore.state.keys.find((candidate) => candidate.id === agreementKeyId);
  if (!agreementKey?.publicKey) {
    throw new Error("the generated key-agreement key did not surface a public key");
  }

  const identity = buildLocalIdentity(ctx, key, agreementKey);
  await ctx.identity.store.addIdentity(identity);
  return identity;
}

/**
 * Re-projects the persisted identity keys into the shared identity store
 * on page load: the keystore's keys survive a reload (IndexedDB), but the
 * identity store is in-memory only; without this kick a previously
 * minted local identity would show its keys in the Local Keystore panel
 * yet be missing from the Identities panel. Each persisted Ed25519
 * identity key is paired back with its X25519 companion (linked via
 * `metadata.identityKeyId`) and its {@link LocalIdentity} rebuilt.
 * Identities already present (same `did:key` address) are left alone, so
 * the kick is idempotent. Kicked by the connector when it constructs the
 * provider (see `../provider/adapter.ts`).
 */
export async function rehydrateLocalIdentities(ctx: DappProvider): Promise<void> {
  const keystore = ctx.key.store;
  // Resolves once the persisted key metadata has been hydrated into the
  // reactive store (optional: an injected backend may have no ready phase).
  await keystore.ready;
  const keys = keyStore.state.keys;
  for (const key of keys.filter(isIdentityKey)) {
    if (!key.publicKey) continue;
    const did = generateDidKey(key.publicKey);
    if (await ctx.identity.store.getIdentity(did)) continue;
    const agreementKey = keys.find(
      (candidate) => isKeyAgreementKey(candidate) && candidate.metadata?.identityKeyId === key.id,
    );
    await ctx.identity.store.addIdentity(buildLocalIdentity(ctx, key, agreementKey));
  }
}

/**
 * Removes a local identity and the keystore keys backing it (the
 * Ed25519 signing key and its X25519 key-agreement companion). Remote
 * (wallet-synced) identities are session-scoped and managed by the
 * adapter instead.
 */
export async function removeLocalIdentity(
  ctx: DappProvider,
  identity: LocalIdentity,
): Promise<void> {
  await ctx.identity.store.removeIdentity(identity.address);
  await ctx.key.store.remove(identity.metadata.keyId);
  if (identity.metadata.agreementKeyId) {
    await ctx.key.store.remove(identity.metadata.agreementKeyId);
  }
}
