/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/keystore-web` is the browser entry point for the
 * keystore. The shared cryptographic implementation (the composable Subtle
 * shims and the platform-neutral {@link createKeyStore} engine) lives in
 * `@algorandfoundation/keystore-core`, relies exclusively on the universal
 * `globalThis.crypto` (`crypto.subtle` / `crypto.getRandomValues`) and pure-JS
 * primitives, so it runs unchanged in the browser and is re-exported here.
 *
 * @remarks
 * This package also ships {@link createWebKeyStore}: a browser-native
 * persistence adapter (the `withIndexDB` storage engine) that implements the
 * {@link KeyStoreAPI} on top of the core composable Subtle shims. Standard host
 * keys are persisted as non-extractable `CryptoKey`s (structured-cloned into
 * IndexedDB, so their bytes never live in JS); shim key material (BIP32-Ed25519
 * roots, Falcon private keys) and raw seeds are stored encrypted at rest with a
 * non-extractable AES-GCM master key. The reactive store holds only metadata.
 */

export * from "@algorandfoundation/keystore-core";
export { createWebKeyStore, type WebKeyStore, type WebKeyStoreOptions } from "./engine.ts";
export { WithKeyStore, type WebKeystoreOptions } from "./extension.ts";
export {
  KeyStoreDatabase,
  MATERIAL_STORE,
  METADATA_STORE,
  type MaterialRecord,
  openDatabase,
} from "./storage/db.ts";
export { createIndexedDBDriver, type IndexedDBDriverOptions } from "./storage/driver.ts";
export { getMasterKey, MASTER_KEY_ID, open, seal, type SealedBytes } from "./storage/vault.ts";
