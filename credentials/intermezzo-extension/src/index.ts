/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials-intermezzo-extension` bridges the
 * credentials domain to an intermezzo OID4VC issuer/verifier host. The
 * {@link WithIntermezzoCredentials} extension mounts a holder-side API at
 * `provider.credential.intermezzo` (credential offers, offer redemption via
 * the OID4VCI pre-authorized-code flow, presentation requests and OID4VP
 * `direct_post` responses) and mirrors the host's issuance/verification
 * sessions into the already-mounted credential store, so the UI drives
 * everything from one reactive store. It owns the `options.intermezzo`
 * namespace ({@link IntermezzoNamespace}) on the shared `ExtensionOptions`
 * registry, which sibling intermezzo bridges augment. The HTTP transport lives
 * in `@algorandfoundation/intermezzo-client` and is re-exported here for
 * convenience; this bridge is an opt-in install outside the
 * `@algorandfoundation/credentials` meta package.
 */

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
