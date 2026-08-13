import { WithIntermezzoIdentities } from "./extension.ts";

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

export default WithIntermezzoIdentities;
