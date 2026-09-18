/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities-intermezzo-extension` bridges the
 * identities domain to an intermezzo backend. The
 * {@link WithIntermezzoIdentities} extension mounts
 * `provider.identity.intermezzo`: manager identity endpoints, the
 * credential-gated `did:algo` anchoring flow (`anchorIdentity`, which records
 * the anchor snapshot through `provider.identity.store.updateIdentityMetadata`)
 * and DID-document update flows, configured from the `options.intermezzo`
 * block owned by `@algorandfoundation/credentials-intermezzo-extension`. It
 * requires `WithIdentities` and `WithCredentials` on the provider. The signer
 * helpers ({@link createIdentityAlgorandSigner}, {@link signGroupForIdentity})
 * and the re-exported `IntermezzoClient` run standalone, no Provider required.
 */

export * from "./extension.ts";
export {
  createIdentityAlgorandSigner,
  signGroupForIdentity,
  type AddressWithSigners,
  type TransactionSigner,
} from "./algorandSigner.ts";

// Re-export the shared transport types/client so existing consumers
// importing them from this package keep working. New code should
// import directly from `@algorandfoundation/intermezzo-client`.
export { IntermezzoClient, IntermezzoHttpError } from "@algorandfoundation/intermezzo-client";
export type {
  BuildUserContractCreateRequest,
  BuildUserContractCreateResponse,
  BuildUserDidDocumentUpdateRequest,
  BuildUserDidDocumentUpdateResponse,
  CredentialPresentationOptions,
  IntermezzoClientConfig,
  ManagerIdentityResponse,
  SignedUserDidUpdateGroup,
  SubmitUserContractCreateRequest,
  SubmitUserContractCreateResponse,
  SubmitUserDidDocumentUpdateRequest,
  SubmitUserDidDocumentUpdateResponse,
  UnsignedAlgorandGroup,
} from "@algorandfoundation/intermezzo-client";
