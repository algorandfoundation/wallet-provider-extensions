import type { Extension, ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { IdentitiesExtension } from "@algorandfoundation/identities-extension";
import type { IdentityStoreState } from "@algorandfoundation/identities-store";
import type { Store } from "@tanstack/store";
import type { CredentialStoreExtension } from "@algorandfoundation/credentials-core";
import {
  IntermezzoClient,
  type BuildUserContractCreateRequest,
  type BuildUserContractCreateResponse,
  type BuildUserDidDocumentUpdateResponse,
  type IntermezzoClientConfig,
  type ManagerIdentityResponse,
  type SignedUserDidUpdateGroup,
  type SubmitUserContractCreateResponse,
  type SubmitUserDidDocumentUpdateResponse,
} from "@algorandfoundation/intermezzo-client";
import type { IntermezzoCredentialsExtension } from "@algorandfoundation/credentials-intermezzo-extension";
import {
  createIdentityAlgorandSigner,
  signGroupForIdentity,
  type AddressWithSigners,
} from "./algorandSigner.ts";

/**
 * Options for {@link WithIntermezzoIdentities}.
 *
 * Wires the manager DID-document
 * (`/wallet/manager/identity`) endpoints of `intermezzo-fresh` onto
 * the identities extension surface. OID4VC issuer/verifier flows
 * live in the sibling `@algorandfoundation/credentials-intermezzo-extension`
 * package.
 */
export interface IntermezzoIdentitiesExtensionOptions extends ExtensionOptions {
  /**
   * The identities extension's reactive store, as passed to
   * `WithIdentityStore` / `WithIdentities`. When provided,
   * {@link IntermezzoIdentitiesApi.anchorIdentity} records the anchor
   * snapshot in the identity's `metadata` (the identity-store API
   * exposes no metadata setter, so the underlying TanStack store is
   * mutated directly — persistence sidecars subscribed to it stay in
   * sync).
   */
  identities?: {
    store: Store<IdentityStoreState>;
  };
  intermezzo: IntermezzoClientConfig & {
    /**
     * Optional pre-built shared client. When provided, this client
     * is reused instead of constructing a new one — this is how the
     * credentials and identities extensions share connection state
     * (auth token cache, custom `fetch`, etc.) when mounted side by
     * side.
     */
    client?: IntermezzoClient;
  };
}

/**
 * Identity-side API exposed at `provider.identity.intermezzo`.
 *
 * Everything is scoped to a specific local identity (via
 * `identityAddress`). The bridge resolves the `did:key` for the
 * identity from the identities store so callers don't need to plumb
 * key material themselves.
 */
export interface IntermezzoIdentitiesApi {
  /** Raw HTTP client for advanced flows. */
  client: IntermezzoClient;

  /** `GET /wallet/manager/identity`. */
  getManagerIdentity(): Promise<ManagerIdentityResponse>;
  /** `POST /wallet/manager/identity` (idempotent — returns undefined on 409). */
  deployManagerIdentity(): Promise<ManagerIdentityResponse | undefined>;

  /**
   * Returns an algokit-utils {@link AddressWithSigners} backed by
   * the identity's Ed25519 key — i.e. the same key encoded in its
   * `did:key`. Use the `signer` field with an
   * {@link import('@algorandfoundation/algokit-utils/transact').TransactionComposer}
   * when assembling the wallet-owned positions of a `did:algo`
   * create / update atomic group.
   *
   * Throws if the identity has no `sign` callback (e.g. it's not
   * managed by the identities-keystore extension) or its `did:key`
   * is not Ed25519-encoded.
   */
  getAlgorandSigner(req: { identityAddress: string }): Promise<AddressWithSigners>;

  /**
   * End-to-end "anchor on chain" upgrade path for an identity that
   * already has a device-attestation credential:
   *
   *   1. Build the on-chain `did:algo` create txn group via
   *      {@link buildUserContractCreate}, gated by the link
   *      credential presentation.
   *   2. Sign the wallet-owned positions (those listed in
   *      `group.indexesToSign`) with the identity's Ed25519 key.
   *   3. Submit the wallet-signed group via
   *      {@link submitUserContractCreate}. The host fills in the
   *      manager positions, broadcasts the atomic group, and
   *      returns the freshly registered `did:algo`.
   *
   * The returned {@link AddressWithSigners} is the Algorand signer
   * derived from the identity's `did:key` and is surfaced so the
   * caller can drive further chain-level interactions (e.g. document
   * updates) without re-deriving it.
   *
   * `credentialPresentation` MUST be a compact SD-JWT VC presentation
   * of the link (device-attestation) credential.
   */
  anchorIdentity(req: {
    identityAddress: string;
    /**
     * Compact SD-JWT VC presentation of the link (device-attestation)
     * credential.
     */
    credentialPresentation: string;
  }): Promise<{
    /** Raw response of `POST /v1/did/create/transactions`. */
    buildResponse: BuildUserContractCreateResponse;
    /**
     * Response of `POST /v1/did/create/submit`, including the
     * freshly registered `did:algo`, app id and confirmation txn id.
     */
    submitResponse: SubmitUserContractCreateResponse;
    /** Algorand signer derived from the identity's `did:key`. */
    signer: AddressWithSigners;
  }>;

  // --- holder DID transactions -------------------------------------------
  //
  // All four endpoints are credential-gated by the device-attestation
  // SD-JWT VC. Callers must build a
  // compact presentation of that credential and pass it in
  // `credentialPresentation` — it is forwarded as the
  // `x-credential-presentation` header. The manager JWT is sourced
  // by the underlying client from `options.intermezzo.getAuthToken`.

  /**
   * `POST /v1/did/create/transactions` — build the unsigned atomic
   * txn group to deploy this identity's `did:algo:...` contract.
   */
  buildUserContractCreate(req: {
    identityAddress: string;
    /** Compact SD-JWT VC presentation of the device-attestation credential. */
    credentialPresentation: string;
    /** Optional pass-through body fields. */
    body?: BuildUserContractCreateRequest;
  }): Promise<BuildUserContractCreateResponse>;

  /**
   * `POST /v1/did/create/submit` — broadcast the wallet-signed
   * `applicationCreate` group and register the new `did:algo:...`.
   */
  submitUserContractCreate(req: {
    identityAddress: string;
    /**
     * Wallet-signed transactions in canonical group order,
     * base64-encoded. `null` at every position the wallet did not
     * sign (host signs manager positions at submit time).
     */
    signedTxns: (string | null)[];
    credentialPresentation: string;
  }): Promise<SubmitUserContractCreateResponse>;

  /**
   * `POST /v1/did/update/transactions` — build the atomic groups
   * needed to publish a new DID document for this identity's
   * `did:algo:...` contract.
   */
  buildUserDidDocumentUpdate(req: {
    identityAddress: string;
    credentialPresentation: string;
    /**
     * Replacement DID document. Omit to use the canonical
     * wallet-owned document built by the server.
     */
    document?: Record<string, unknown>;
  }): Promise<BuildUserDidDocumentUpdateResponse>;

  /**
   * `POST /v1/did/update/submit` — submit the wallet-signed atomic
   * groups returned by {@link buildUserDidDocumentUpdate}.
   */
  submitUserDidDocumentUpdate(req: {
    identityAddress: string;
    credentialPresentation: string;
    /**
     * The exact DID document supplied to the matching build call
     * (or omitted if it was). The host rebuilds canonical bytes
     * from it to validate wallet signatures.
     */
    document?: Record<string, unknown>;
    /**
     * Atomic groups produced by the build endpoint, each now
     * wallet-signed, submitted serially in order.
     */
    groups: SignedUserDidUpdateGroup[];
  }): Promise<SubmitUserDidDocumentUpdateResponse>;
}

/** The extension surface contributed by {@link WithIntermezzoIdentities}. */
export interface IntermezzoIdentitiesExtension extends IdentitiesExtension {
  identity: IdentitiesExtension["identity"] & {
    intermezzo: IntermezzoIdentitiesApi;
  };
}

/**
 * Wires the intermezzo-fresh manager
 * DID-document (`/wallet/manager/identity`) endpoints into the
 * wallet provider.
 *
 * Depends on
 *   - {@link import('@algorandfoundation/identities-extension').WithIdentities}
 *     (mounts `provider.identity.store`), and
 *   - {@link import('@algorandfoundation/credentials-intermezzo-extension').WithIntermezzoCredentials}
 *     (provides `redeemOfferUri`).
 *
 * Both must be already present on the provider when this extension is
 * applied.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider()
 *   .extend(WithIdentities, { ... })
 *   .extend(WithCredentials, { ... })
 *   .extend(WithIntermezzoCredentials, { intermezzo: { baseUrl } })
 *   .extend(WithIntermezzoIdentities, { intermezzo: { baseUrl } });
 * ```
 */
export const WithIntermezzoIdentities: Extension<IntermezzoIdentitiesExtension> = (
  provider: IdentitiesExtension &
    CredentialStoreExtension &
    Partial<IntermezzoCredentialsExtension> &
    Partial<LogStoreExtension>,
  options: IntermezzoIdentitiesExtensionOptions,
) => {
  const log = provider.log;

  if (!provider.identity) {
    throw new Error(
      "WithIntermezzoIdentities requires WithIdentities to be present on the provider.",
    );
  }
  if (!provider.credential) {
    throw new Error(
      "WithIntermezzoIdentities requires WithCredentials to be present on the provider.",
    );
  }
  if (!options?.intermezzo?.client && !options?.intermezzo?.baseUrl) {
    throw new Error("WithIntermezzoIdentities requires options.intermezzo.baseUrl.");
  }

  const client = options.intermezzo.client ?? new IntermezzoClient(options.intermezzo);

  /**
   * Resolves the holder `did:key` for an identity, falling back to
   * `identity.address` (which for `did:key`-backed identities is the
   * canonical URL).
   */
  async function resolveHolderDidKey(identityAddress: string): Promise<string> {
    const identity = await provider.identity.store.getIdentity(identityAddress);
    if (!identity) {
      throw new Error(`WithIntermezzoIdentities: unknown identity ${identityAddress}`);
    }
    return identity.did ?? identity.address;
  }

  const intermezzoApi: IntermezzoIdentitiesApi = {
    client,

    getManagerIdentity: () => client.getManagerIdentity(),
    deployManagerIdentity: () => client.deployManagerIdentity(),

    async getAlgorandSigner(req) {
      const identity = await provider.identity.store.getIdentity(req.identityAddress);
      if (!identity) {
        throw new Error(
          `WithIntermezzoIdentities.getAlgorandSigner: unknown identity ${req.identityAddress}`,
        );
      }
      log?.info(
        `getAlgorandSigner called: identity=${req.identityAddress}`,
        {},
        "IntermezzoIdentities",
      );
      return createIdentityAlgorandSigner(identity);
    },

    async anchorIdentity(req) {
      log?.info(
        `anchorIdentity called: identity=${req.identityAddress}`,
        {},
        "IntermezzoIdentities",
      );
      // 1. Ask intermezzo to build the on-chain create-app txn group.
      //    The server validates the `x-credential-presentation`
      //    header as a JWT, so we MUST send a real compact SD-JWT VC.
      const buildResponse = await intermezzoApi.buildUserContractCreate({
        identityAddress: req.identityAddress,
        credentialPresentation: req.credentialPresentation,
      });
      // 2. Sign the wallet-owned positions of the returned atomic
      //    group with the identity's Ed25519 key. The server tells
      //    us which positions to sign via `group.indexesToSign`
      //    (typically just the user's `applicationCreate`).
      const anchoredIdentity = await provider.identity.store.getIdentity(req.identityAddress);
      if (!anchoredIdentity) {
        throw new Error(
          `WithIntermezzoIdentities.anchorIdentity: identity ${req.identityAddress} disappeared`,
        );
      }
      const signedTxns = await signGroupForIdentity(buildResponse.group, anchoredIdentity);
      // 3. Submit the wallet-signed group; the host adds manager
      //    signatures, broadcasts, and returns the freshly
      //    registered `did:algo`.
      const submitResponse = await intermezzoApi.submitUserContractCreate({
        identityAddress: req.identityAddress,
        credentialPresentation: req.credentialPresentation,
        signedTxns,
      });
      // 4. Hand back an Algorand signer bound to the identity's
      //    `did:key` so the caller can drive further chain-level
      //    interactions (e.g. document updates) without re-deriving it.
      const signer = await intermezzoApi.getAlgorandSigner({
        identityAddress: req.identityAddress,
      });
      // 5. Record the anchor in the identity's metadata so the UI can
      //    later detect whether the local DID document has diverged
      //    from the on-chain version. We snapshot the document that
      //    was anchored at this point in time — comparison happens
      //    later by deep-equality against the live `identity.didDocument`.
      const anchor: Record<string, unknown> = {
        didDocument: anchoredIdentity.didDocument,
        anchoredAt: Date.now(),
        buildResponse,
        submitResponse,
      };
      if (typeof submitResponse.did === "string") {
        anchor.didAlgo = submitResponse.did;
      }
      // Mutate the underlying TanStack store directly: the
      // identity-store API doesn't expose a metadata setter, and
      // persistence sidecars subscribe to this store to stay in
      // sync. The store is injected via `options.identities.store`
      // (the same instance handed to the identities extension).
      const identitiesStore = options?.identities?.store;
      if (identitiesStore) {
        identitiesStore.setState((prev) => ({
          ...prev,
          identities: prev.identities.map((id) =>
            id.address === req.identityAddress
              ? { ...id, metadata: { ...id.metadata, anchor } }
              : id,
          ),
        }));
      } else {
        log?.warn(
          "anchorIdentity: options.identities.store not provided — anchor metadata not persisted",
          {},
          "IntermezzoIdentities",
        );
      }
      return {
        buildResponse,
        submitResponse,
        signer,
      };
    },

    async buildUserContractCreate(req) {
      // Resolve the identity to validate it exists, even though the
      // server keys auth via the credential presentation header.
      await resolveHolderDidKey(req.identityAddress);
      log?.info(
        `buildUserContractCreate called: identity=${req.identityAddress}`,
        {},
        "IntermezzoIdentities",
      );
      return client.buildUserContractCreate(
        { credentialPresentation: req.credentialPresentation },
        req.body ?? {},
      );
    },

    async submitUserContractCreate(req) {
      await resolveHolderDidKey(req.identityAddress);
      log?.info(
        `submitUserContractCreate called: identity=${req.identityAddress}, txns=${req.signedTxns.length}`,
        {},
        "IntermezzoIdentities",
      );
      return client.submitUserContractCreate(
        { signedTxns: req.signedTxns },
        { credentialPresentation: req.credentialPresentation },
      );
    },

    async buildUserDidDocumentUpdate(req) {
      await resolveHolderDidKey(req.identityAddress);
      log?.info(
        `buildUserDidDocumentUpdate called: identity=${req.identityAddress}`,
        {},
        "IntermezzoIdentities",
      );
      return client.buildUserDidDocumentUpdate(
        { credentialPresentation: req.credentialPresentation },
        req.document !== undefined ? { document: req.document } : {},
      );
    },

    async submitUserDidDocumentUpdate(req) {
      await resolveHolderDidKey(req.identityAddress);
      log?.info(
        `submitUserDidDocumentUpdate called: identity=${req.identityAddress}, groups=${req.groups.length}`,
        {},
        "IntermezzoIdentities",
      );
      return client.submitUserDidDocumentUpdate(
        {
          ...(req.document !== undefined ? { document: req.document } : {}),
          groups: req.groups,
        },
        { credentialPresentation: req.credentialPresentation },
      );
    },
  };

  return {
    ...provider,
    identity: {
      ...provider.identity,
      intermezzo: intermezzoApi,
    },
  } as IntermezzoIdentitiesExtension;
};
