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
 *
 * Finally, it ships the [Open Wallet Standard](https://openwallet.sh/) adapter
 * ({@link createOwsKeyStore}, {@link WithOwsKeyStore}): the same keystore
 * surface served by an OWS vault, which keeps custody of the seed and enforces
 * its policy engine, reached either through the OWS NAPI bindings or the `ows`
 * CLI. See the `./ows` subpath export for the full surface.
 */

export * from "@algorandfoundation/keystore-core";
export { type CliDeps, type CliIO, runCli } from "./cli.ts";
export { createNodeKeyStore, type NodeKeyStore, type NodeKeyStoreOptions } from "./engine.ts";
export { WithKeyStore, type NodeKeystoreOptions } from "./extension.ts";
export {
  createKeyStoreRpcServer,
  createKeyStoreWebSocketServer,
  createRpcKeyStore,
  createSocketTransport,
  DEFAULT_KEYSTORE_WS_PORT,
  defaultRpcSocketPath,
  isRpcMethod,
  RPC_METHODS,
  type KeyStoreRpcServer,
  type KeyStoreRpcServerOptions,
  type KeyStoreWebSocketServer,
  type KeyStoreWebSocketServerOptions,
  type RpcKeyStore,
  type RpcKeyStoreOptions,
  type RpcMethod,
  type SocketTransportOptions,
  type WebSocketServerFactory,
} from "./rpc/index.ts";
export {
  createKeyStoreResponder,
  createLoopbackTransport,
  createRemoteKeyStore,
  createWebSocketTransport,
  WithRemoteKeyStore,
  withRemoteKeyStoreAt,
  type KeyStoreResponder,
  type RemoteChannel,
  type RemoteKeyStore,
  type RemoteKeyStoreBlock,
  type RemoteKeyStoreOptions,
  type RemoteKeystoreOptions,
  type RemoteTransport,
} from "@algorandfoundation/keystore-remote";
export {
  createOwsBinding,
  createOwsCliBinding,
  createOwsKeyStore,
  createOwsNativeBinding,
  OwsError,
  OwsUnsupportedOperationError,
  resolveOwsBinding,
  WithOwsKeyStore,
  type OwsBinding,
  type OwsContext,
  type OwsKeyStore,
  type OwsKeystoreOptions,
  type OwsKeyStoreOptions,
} from "./ows/index.ts";
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
