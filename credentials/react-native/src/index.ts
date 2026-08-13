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
 * This package additionally ships the React Native seam for the W3C Digital
 * Credentials API: {@link reactNativeDigitalCredentials} (currently an
 * explicit `unsupported` stub) and a React Native `WithCredentials` extension
 * that attaches it at `provider.credential.digital`. When the Android
 * Credential Manager / iOS backing lands, only the stub is replaced — the
 * application-facing surface stays the same.
 */

export * from "@algorandfoundation/credentials-core";
export { reactNativeDigitalCredentials } from "./platform.ts";
export { WithCredentials, type ReactNativeCredentialsExtension } from "./extension.ts";
