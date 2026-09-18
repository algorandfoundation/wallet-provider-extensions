/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials-core` holds the platform-neutral surface of
 * the credentials domain: the Universal Wallet 2020-aligned `Credential` types,
 * the pure store functions and the `createCredentialStore` engine (reactive
 * `@tanstack/store` state, `before-after-hook` interception and a tiny
 * key/value persistence seam), the `HolderBinding` seam that decouples
 * credentials from whichever domain signs as the user, the OID4VCI/OID4VP,
 * SD-JWT VC, `did:key` and JWS utilities, and the W3C Digital Credentials API
 * contracts. Like `@algorandfoundation/keystore-core` it exports **no mounted
 * extension** of its own; the platform packages
 * (`@algorandfoundation/credentials-node`, `@algorandfoundation/credentials-web`,
 * `@algorandfoundation/react-native-credentials`) re-export this package and add
 * a `WithCredentials` extension built on the engine with a platform persistence
 * driver. It also owns the `options.credentials` namespace
 * ({@link CredentialsNamespace}) on the shared `ExtensionOptions` registry,
 * which the platform packages and bridges augment.
 *
 * Most consumers should import the meta package `@algorandfoundation/credentials`,
 * which resolves to the correct platform implementation via package export
 * conditions.
 */

export * from "./engine.ts";
export * from "./holder.ts";
export * from "./store.ts";
export * from "./types.ts";
export * from "./digital-credentials.ts";
export * from "./utils/index.ts";
