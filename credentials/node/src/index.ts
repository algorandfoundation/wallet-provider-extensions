/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/credentials-node` is the Node.js / server entry point
 * for the credentials domain. The platform-neutral implementation (the
 * `createCredentialStore` engine, the holder-binding seam, the
 * OID4VC/SD-JWT/`did:key` utilities and the Digital Credentials platform
 * contract) lives in `@algorandfoundation/credentials-core` and is re-exported
 * here.
 *
 * @remarks
 * This package adds the node `WithCredentials` extension, which builds the
 * core engine over an injected `options.credentials.driver` (any string
 * key/value store; in-memory when omitted), auto-binds an identities store
 * when one is mounted, lazily mounts the connections bridge at
 * `provider.credential.remote`, and attaches {@link nodeDigitalCredentials}
 * at `provider.credential.digital`, a permanent explicit `unsupported`
 * implementation because node has no user-agent credential chooser.
 */

export * from "@algorandfoundation/credentials-core";
export { nodeDigitalCredentials } from "./platform.ts";
export {
  WithCredentials,
  type NodeCredentialsExtension,
  type NodeCredentialsOptions,
} from "./extension.ts";
export type {
  CredentialRecord,
  CredentialsConnectionsExtension,
  CredentialsConnectionsOptions,
  RemoteCredentialsMirror,
} from "@algorandfoundation/credentials-connections-extension";
