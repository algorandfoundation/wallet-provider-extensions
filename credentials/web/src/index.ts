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
 * This package additionally ships the browser seam for the W3C Digital
 * Credentials API: {@link webDigitalCredentials} (currently an explicit
 * `unsupported` stub) and a browser `WithCredentials` extension that attaches
 * it at `provider.credential.digital`. When
 * `navigator.credentials.get({ digital })` support lands, only the stub is
 * replaced — the application-facing surface stays the same.
 */

export * from "@algorandfoundation/credentials-core";
export { localStorageCredentialDriver } from "./driver.ts";
export { webDigitalCredentials } from "./platform.ts";
export { WithCredentials, type WebCredentialsExtension } from "./extension.ts";
