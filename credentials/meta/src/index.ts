/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials` is a thin **meta package**. Its
 * `package.json` `exports` map uses runtime/bundler conditions to resolve to
 * the correct platform package:
 *
 * - `node` / default  → the platform-neutral `@algorandfoundation/credentials-core`
 *   surface plus a node `WithCredentials` extension and an explicit node
 *   `unsupported` Digital Credentials stub
 * - `browser`         → `@algorandfoundation/credentials-web`
 * - `react-native`    → `@algorandfoundation/react-native-credentials`
 *
 * Every condition re-exports `@algorandfoundation/credentials-core` (the
 * `createCredentialStore` engine, the holder-binding seam, the OID4VC/SD-JWT/
 * `did:key` utilities and the Digital Credentials platform contract) and
 * exports a platform `WithCredentials` extension built on that engine —
 * exactly how `@algorandfoundation/keystore` resolves `WithKeyStore`.
 *
 * @remarks
 * The meta package is deliberately **backend-agnostic**: bridges to concrete
 * issuance/verification backends (e.g.
 * `@algorandfoundation/credentials-intermezzo-extension`) are separate opt-in
 * installs.
 */

export * from "@algorandfoundation/credentials-core";
export { nodeDigitalCredentials } from "./platform.ts";
export { WithCredentials, type NodeCredentialsExtension } from "./extension.ts";
