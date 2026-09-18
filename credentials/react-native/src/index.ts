/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/react-native-credentials` is the React Native entry
 * point for the credentials domain. The platform-neutral implementation (the
 * reactive credential store, OID4VC/SD-JWT/`did:key` utilities and the Digital
 * Credentials platform contract) lives in
 * `@algorandfoundation/credentials-core` and is re-exported here.
 *
 * @remarks
 * This package additionally ships the React Native seams for the W3C Digital
 * Credentials API:
 *
 * - The *requester* side {@link reactNativeDigitalCredentials} (still an
 *   explicit `unsupported` stub) attached at `provider.credential.digital`.
 *   When the Android Credential Manager / iOS backing lands, only the stub
 *   is replaced; the application-facing surface stays the same.
 * - The *wallet/holder* side {@link nativeDigitalCredentialsProvider} over
 *   the injectable {@link DigitalCredentialsModuleLike} seam, attached at
 *   `provider.credential.digitalProvider` by the `WithCredentials`
 *   extension. It is backed by the Digital Credentials **expo native
 *   module bundled with this package** (`android/`, `ios/`,
 *   `expo-module.config.json`), resolved lazily by
 *   {@link defaultDigitalCredentialsModule} so importing this package in a
 *   plain Node runtime (tests, tooling) never touches native code. The module
 *   is injectable through `options.credentials.digitalCredentialsModule`,
 *   which this package registers on the shared `CredentialsNamespace`.
 */

export * from "@algorandfoundation/credentials-core";
export { reactNativeDigitalCredentials } from "./platform.ts";
export {
  defaultDigitalCredentialsModule,
  nativeDigitalCredentialsProvider,
  toRegisteredCredential,
  unsupportedDigitalCredentialsProvider,
  type DigitalCredentialsModuleLike,
  type DigitalCredentialsPresentationRequestEvent,
  type RegisteredDigitalCredential,
  type RegisteredDigitalCredentialClaim,
} from "./provider.ts";
export {
  WithCredentials,
  type ReactNativeCredentialsExtension,
  type ReactNativeCredentialsOptions,
} from "./extension.ts";
export type {
  CredentialRecord,
  CredentialsConnectionsExtension,
  CredentialsConnectionsOptions,
  RemoteCredentialsMirror,
} from "@algorandfoundation/credentials-connections-extension";
// Runtime-safe pieces of the bundled native module (the module binding
// itself is only loaded lazily; see defaultDigitalCredentialsModule).
export { MAX_ENTRY_ID_LENGTH, validateEntries } from "./digital/entries.ts";
export type {
  PresentationRequestEvent,
  ReactNativeDigitalCredentialsModuleEvents,
  RegisteredClaim,
  RegisteredSdJwtCredential,
} from "./digital/types.ts";
