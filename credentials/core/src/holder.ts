/**
 * The holder-binding seam.
 *
 * The credential store needs exactly two things from whatever "owns" the
 * holder of a credential:
 *
 * 1. a way to resolve a {@link JwsSigner} for a holder address so the
 *    OID4VC utilities can produce proofs/presentations, and
 * 2. a way to learn when a holder goes away so scoped credentials and
 *    sessions can be evicted.
 *
 * Both are captured by the {@link HolderBinding} contract instead of a hard
 * dependency on the identities extension. Today the canonical binding is
 * {@link identityHolderBinding} (an adapter over an
 * `@algorandfoundation/identities-store`-shaped store), but a holder can be
 * **any** domain that signs as the user — an identity key, or a formal
 * document that represents the user, such as an mDoc obtained through the
 * Digital Credentials API. Bindings for those sources plug in through the
 * same seam without touching this package.
 */

import { didKeyToJwk, parseDidKey } from "./utils/did-key.ts";
import type { JwsSigner } from "./utils/signer.ts";

/**
 * The minimal, structural shape of a holder record a binding resolves.
 *
 * Deliberately a subset of `Identity` from
 * `@algorandfoundation/identities-store` so that identity stores satisfy it
 * without this package importing that one — and so non-identity holders
 * (e.g. mDoc-backed) can satisfy it too.
 */
export interface HolderIdentity {
  /** Wallet-local address of the holder (typically a `did:key` URL). */
  address: string;
  /** The DID form, when different from the address. */
  did?: string;
  /** Signs each payload in the batch; absent for watch-only holders. */
  sign?: (data: Uint8Array[]) => Promise<Uint8Array[]>;
  /** Free-form metadata; `publicKeyJwk`/`kid`/`alg` are honoured as signer fallbacks. */
  metadata?: Record<string, unknown>;
}

/**
 * The structural surface {@link identityHolderBinding} needs from an
 * identity store: lookup by address plus a `before("remove")` hook seam.
 * `@algorandfoundation/identities-store`'s `identity.store` API satisfies
 * this shape as-is.
 */
export interface HolderIdentityStore {
  /** Resolves a holder by wallet-local address. */
  getIdentity(address: string): Promise<HolderIdentity | undefined>;
  /** before-after-hook collection guarding the store's operations. */
  hooks: {
    before(name: "remove", hook: (params: unknown) => void): void;
  };
}

/**
 * Binds the credential store to whatever domain owns credential holders.
 *
 * @remarks
 * This is the decoupling seam between the credentials domain and the
 * identities domain: the store never imports an identity package, it only
 * consumes this contract. It is intentionally minimal so future holder
 * sources (Digital Credentials API mDocs, remote custodians, ...) can
 * implement it as well.
 */
export interface HolderBinding {
  /**
   * Resolves a {@link JwsSigner} for a holder address.
   *
   * @param address - The wallet-local holder address (e.g. `did:key`).
   * @returns The signer, or `undefined` when the holder is unknown or
   *   cannot sign.
   */
  getSigner(address: string): Promise<JwsSigner | undefined>;
  /**
   * Subscribes to holder removal so the store can cascade-evict the
   * credentials and OID4VC sessions scoped to that holder.
   *
   * @param evict - Callback invoked with the removed holder's address.
   */
  onRemoved?(evict: (address: string) => void): void;
}

/**
 * Bridges a {@link HolderIdentity} to a {@link JwsSigner} so credential
 * utilities (`signCompactJwt`, `buildSdJwtPresentation`, OID4VCI holder
 * proof, OID4VP VP token) can sign with the holder's on-device key without
 * callers having to re-plumb the keystore. The holder's
 * `sign(Uint8Array[]) → Uint8Array[]` is adapted to the single-signature
 * shape JWS expects.
 *
 * When the holder address is a `did:key`, `alg`/`kid`/JWK are derived from
 * it; otherwise the function falls back to `metadata.publicKeyJwk` /
 * `metadata.kid` / `metadata.alg`.
 *
 * @param holder - The holder record to adapt.
 * @returns A {@link JwsSigner}, or `undefined` when the holder cannot sign.
 */
export function buildSignerFromHolder(holder: HolderIdentity): JwsSigner | undefined {
  if (!holder.sign) return undefined;
  const did = holder.did ?? holder.address;
  let publicKeyJwk: JwsSigner["publicKeyJwk"];
  let kid: string | undefined;
  let alg = (holder.metadata?.alg as string | undefined) ?? "EdDSA";
  try {
    const parsed = parseDidKey(did);
    publicKeyJwk = didKeyToJwk(did);
    kid = `${parsed.did}#${parsed.multibase}`;
    if (!holder.metadata?.alg) {
      alg =
        parsed.curve === "Ed25519"
          ? "EdDSA"
          : parsed.curve === "P-256"
            ? "ES256"
            : parsed.curve === "P-384"
              ? "ES384"
              : parsed.curve === "secp256k1"
                ? "ES256K"
                : "EdDSA";
    }
  } catch {
    // Holder address is not a did:key (e.g. xhd address); fall back to
    // whatever the caller supplies via metadata.
    publicKeyJwk = (holder.metadata?.publicKeyJwk as JwsSigner["publicKeyJwk"]) ?? {
      kty: "OKP",
    };
    kid = holder.metadata?.kid as string | undefined;
  }
  return {
    alg,
    kid,
    publicKeyJwk,
    async sign(data) {
      const signed = await holder.sign!([data]);
      if (!signed?.[0]) throw new Error("Holder signer returned no signature");
      return signed[0];
    },
  };
}

/**
 * The canonical {@link HolderBinding}: adapts an identities store (the
 * `identity.store` API from `@algorandfoundation/identities-store` or
 * anything matching {@link HolderIdentityStore}) to the holder seam.
 *
 * - `getSigner` resolves the identity and adapts it via
 *   {@link buildSignerFromHolder}.
 * - `onRemoved` attaches as a `before("remove")` hook so that even if
 *   downstream identity-store consumers fail, no dangling credential
 *   material is left behind.
 *
 * @param identityStore - The identity store to bind against.
 * @returns A {@link HolderBinding} backed by the identity store.
 */
export function identityHolderBinding(identityStore: HolderIdentityStore): HolderBinding {
  return {
    async getSigner(address: string): Promise<JwsSigner | undefined> {
      const identity = await identityStore.getIdentity(address);
      if (!identity) return undefined;
      return buildSignerFromHolder(identity);
    },
    onRemoved(evict: (address: string) => void): void {
      identityStore.hooks.before("remove", (params: unknown) => {
        const address =
          typeof params === "string"
            ? params
            : ((params as { address?: string } | undefined)?.address ?? undefined);
        if (!address) return;
        evict(address);
      });
    },
  };
}
