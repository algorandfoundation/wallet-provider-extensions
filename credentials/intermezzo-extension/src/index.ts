import { WithIntermezzoCredentials } from "./extension.ts";

export * from "./extension.ts";

// Re-export the shared transport types/client so existing consumers
// importing them from this package keep working after the split into
// `@algorandfoundation/intermezzo-client`. New code should import
// directly from `@algorandfoundation/intermezzo-client`.
export {
  IntermezzoClient,
  IntermezzoHttpError,
  IntermezzoCredentialsClient,
} from "@algorandfoundation/intermezzo-client";
export type {
  CreateCredentialOfferRequest,
  CreatePresentationRequestRequest,
  CredentialOfferResponse,
  IntermezzoClientConfig,
  IntermezzoCredentialsClientConfig,
  PresentationRequestResponse,
  RemoteIssuanceSession,
  RemoteVerificationSession,
  SetCredentialConfigurationRequest,
} from "@algorandfoundation/intermezzo-client";

export default WithIntermezzoCredentials;
