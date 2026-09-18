/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials-web` is the browser entry point for the
 * credentials domain. The platform-neutral implementation (the reactive
 * credential store, OID4VC/SD-JWT/`did:key` utilities and the Digital
 * Credentials platform contract) lives in
 * `@algorandfoundation/credentials-core` and is re-exported here.
 *
 * @remarks
 * This package additionally ships the browser implementation of the W3C
 * Digital Credentials API: {@link webDigitalCredentials} feature-detects
 * `navigator.credentials.get({ digital })` and forwards presentation
 * (and, where enabled, issuance) requests to the user agent, rejecting
 * with a typed `DigitalCredentialsUnsupportedError` on browsers without the
 * API. The browser `WithCredentials` extension attaches it at
 * `provider.credential.digital`, persists through
 * {@link localStorageCredentialDriver} by default, and reads its configuration
 * from the shared `options.credentials` namespace owned by the core.
 */

export * from "@algorandfoundation/credentials-core";
export { localStorageCredentialDriver } from "./driver.ts";
export { webDigitalCredentials } from "./platform.ts";
export {
  WithCredentials,
  type WebCredentialsExtension,
  type WebCredentialsOptions,
} from "./extension.ts";
export type {
  CredentialRecord,
  CredentialsConnectionsExtension,
  CredentialsConnectionsOptions,
  RemoteCredentialsMirror,
} from "@algorandfoundation/credentials-connections-extension";
