/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/keystore-node` is the Node.js / server entry point for
 * the keystore. The shared cryptographic implementation — the composable Subtle
 * shims and the platform-neutral {@link createKeyStore} engine — lives in
 * `@algorandfoundation/keystore-core` and relies only on the universal
 * `globalThis.crypto` (`crypto.subtle` / `crypto.getRandomValues`) and pure-JS
 * primitives, so it runs unchanged on Node and other server runtimes; it is
 * re-exported here.
 *
 * @remarks
 * This package also ships {@link createNodeKeyStore}: an OS-keychain persistence
 * engine that implements the {@link KeyStoreAPI} on top of the core composable
 * Subtle shims. Secret material is stored directly in the operating-system
 * keychain (via `@napi-rs/keyring`, relying on its encryption at rest; oversized
 * material such as Falcon-1024 private keys is chunked across entries to stay
 * under platform per-entry caps), while all UI-safe metadata is kept in a single
 * AES-GCM sealed file keyed by a small master key held in the keychain. The
 * reactive store holds only metadata.
 */

export * from "@algorandfoundation/keystore-core";
export { type CliDeps, type CliIO, runCli } from "./cli.ts";
export { createNodeKeyStore, type NodeKeyStore, type NodeKeyStoreOptions } from "./engine.ts";
export { WithKeyStore, type NodeKeystoreOptions } from "./extension.ts";
export {
  createKeyStoreRpcServer,
  createRpcKeyStore,
  defaultRpcSocketPath,
  isRpcMethod,
  RPC_METHODS,
  type KeyStoreRpcServer,
  type KeyStoreRpcServerOptions,
  type RpcKeyStore,
  type RpcKeyStoreOptions,
  type RpcMethod,
} from "./rpc/index.ts";
export { createKeychainDriver, type KeychainDriverDeps } from "./storage/driver.ts";
export {
  createNapiKeyring,
  type KeyringBinding,
  type NapiKeyringOptions,
} from "./storage/keyring.ts";
export {
  createFileMetadataStore,
  defaultMetadataPath,
  type FileMetadataStoreOptions,
  type MetadataFile,
} from "./storage/metadata.ts";
