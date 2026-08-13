import {
  decodeTransaction,
  encodeTransaction,
  encodeSignedTransaction,
  generateAddressWithSigners,
} from "@algorandfoundation/algokit-utils/transact";
import type {
  AddressWithSigners,
  SignedTransaction,
  TransactionSigner,
} from "@algorandfoundation/algokit-utils/transact";
import type { Identity } from "@algorandfoundation/identities-store";
import { parseDidKey } from "@algorandfoundation/credentials-core";
import type { UnsignedAlgorandGroup } from "@algorandfoundation/intermezzo-client";

/**
 * Adapts a wallet {@link Identity} (a `did:key`-backed signer
 * managed by the identities-keystore extension) into an
 * algokit-utils {@link AddressWithSigners}.
 *
 * The intermezzo `did:algo` deployment flow expects the wallet to
 * Ed25519-sign specific positions of an atomic txn group with the
 * key bound to its `did:key`. We reuse the existing
 * `identity.sign(Uint8Array[])` callback (which the keystore
 * extension wires up to the platform-protected seed key) as the
 * raw signer, and derive the canonical Algorand address from the
 * Ed25519 public key encoded inside the `did:key`.
 *
 * @example
 * ```ts
 * const { sendingAddress, signer } = createIdentityAlgorandSigner(identity);
 * // signer: TransactionSigner — pass to AtomicTransactionComposer.addTransaction()
 * ```
 *
 * @throws if `identity.sign` is not present (e.g. for non-keystore identities)
 *         or if the `did:key` does not encode an Ed25519 public key.
 */
export function createIdentityAlgorandSigner(identity: Identity): AddressWithSigners {
  if (!identity.sign) {
    throw new Error(
      `Identity ${identity.address} has no sign callback — cannot derive Algorand signer.`,
    );
  }
  const didKey = identity.did ?? identity.address;
  const parsed = parseDidKey(didKey);
  if (parsed.curve !== "Ed25519") {
    throw new Error(
      `Identity ${identity.address} did:key curve is ${parsed.curve}; only Ed25519 is supported for Algorand signing.`,
    );
  }

  const rawEd25519Signer = async (data: Uint8Array): Promise<Uint8Array> => {
    // identity.sign accepts a batch of byte-strings and returns one
    // signature per input; we always sign a single message here.
    const [signature] = await identity.sign!([data]);
    if (!signature) {
      throw new Error(`Identity ${identity.address} sign callback returned no signature.`);
    }
    return signature;
  };

  return generateAddressWithSigners({
    ed25519Pubkey: parsed.publicKey,
    rawEd25519Signer,
  });
}

export type { AddressWithSigners, TransactionSigner };

/**
 * Sign every position listed in `group.indexesToSign` with the
 * identity's Ed25519 key, returning a `(string | null)[]` ready for
 * the `/v1/did/{create,update}/submit` endpoints: base64-encoded
 * `SignedTransaction` at each signed position, `null` at every
 * position the wallet did not sign (the host fills in manager
 * positions before broadcast).
 *
 * Canonical Ed25519 over the msgpack-encoded transaction bytes via
 * `encodeTransaction` — exactly the bytes algod expects to verify
 * (and what intermezzo rebuilds for byte-for-byte validation before
 * counter-signing).
 *
 * @param group     Unsigned group as returned by either
 *                  `buildUserContractCreate` or `buildUserDidDocumentUpdate`.
 * @param identity  The wallet identity whose `sign` callback is used
 *                  to produce the raw Ed25519 signatures.
 */
export async function signGroupForIdentity(
  group: UnsignedAlgorandGroup,
  identity: Identity,
): Promise<(string | null)[]> {
  if (!identity.sign) {
    throw new Error(
      `Identity ${identity.address} has no sign callback — cannot sign Algorand txn group.`,
    );
  }
  const out: (string | null)[] = Array.from({ length: group.txnGroup.length }, () => null);
  // Sign all canonical msgpack inputs in a single batched call so
  // the identity's signer can amortise key access if it wishes.
  const messages: Uint8Array[] = [];
  const decoded: ReturnType<typeof decodeTransaction>[] = [];
  for (const i of group.indexesToSign) {
    const unsigned = Buffer.from(group.txnGroup[i], "base64");
    const txn = decodeTransaction(new Uint8Array(unsigned));
    decoded.push(txn);
    messages.push(new Uint8Array(encodeTransaction(txn)));
  }
  const signatures = await identity.sign(messages);
  group.indexesToSign.forEach((i, k) => {
    const sig = signatures[k];
    if (!sig) {
      throw new Error(
        `Identity ${identity.address} sign callback returned no signature for index ${i}.`,
      );
    }
    const signed: SignedTransaction = { txn: decoded[k], sig: new Uint8Array(sig) };
    out[i] = Buffer.from(encodeSignedTransaction(signed)).toString("base64");
  });
  return out;
}
