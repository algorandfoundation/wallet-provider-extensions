/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials` is a thin **meta package**. It does not
 * contain any implementation of its own; instead its `package.json` `exports`
 * map uses runtime/bundler conditions to resolve to the correct platform
 * package:
 *
 * - `node` / default  → `@algorandfoundation/credentials-node`
 * - `browser`         → `@algorandfoundation/credentials-web`
 * - `react-native`    → `@algorandfoundation/react-native-credentials`
 *
 * All platform packages re-export `@algorandfoundation/credentials-core` (the
 * `createCredentialStore` engine, the holder-binding seam, the
 * OID4VC/SD-JWT/`did:key` utilities and the Digital Credentials platform
 * contract) and export a platform `WithCredentials` extension built on that
 * engine, exactly how `@algorandfoundation/keystore` resolves `WithKeyStore`.
 *
 * @remarks
 * The meta package is deliberately **backend-agnostic**: bridges to concrete
 * issuance/verification backends (e.g.
 * `@algorandfoundation/credentials-intermezzo-extension`) are separate opt-in
 * installs.
 */

export * from "@algorandfoundation/credentials-node";
