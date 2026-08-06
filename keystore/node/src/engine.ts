/**
 * The Node.js / server keystore engine.
 *
 * Like the browser and React Native engines, this is a thin wrapper: it builds
 * an OS-keychain {@link import("./storage/driver.ts").createKeychainDriver}
 * driver and hands it to the shared, platform-neutral
 * {@link createKeyStore} orchestrator in `@algorandfoundation/keystore-core`.
 * All crypto orchestration lives in core and is shared with every other
 * backend; this package only supplies the server persistence — secret material
 * in the OS keychain (via `@napi-rs/keyring`) and all metadata in a single
 * AES-GCM sealed file keyed by a keychain-held master key.
 *
 * The engine is non-interactive, so its per-operation context is `void`. Node's
 * global `crypto.subtle` performs the standard algorithms (Ed25519, ECDSA,
 * AES-GCM) and the core default shims add BIP32-Ed25519, Falcon-1024,
 * Deterministic-P256 and the BIP39/Algo25 seed schemes with no extra wiring.
 */

import {
  createKeyStore,
  type KeyStore,
  type KeyStoreState,
  type SubtleShim,
} from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import { createKeychainDriver } from "./storage/driver.ts";
import { createNapiKeyring, type KeyringBinding } from "./storage/keyring.ts";
import { createFileMetadataStore, type MetadataFile } from "./storage/metadata.ts";

/** Options for {@link createNodeKeyStore}. */
export interface NodeKeyStoreOptions {
  /** Reactive store that mirrors the persisted metadata (never private material). */
  store: Store<KeyStoreState>;
  /** Host Subtle implementation; defaults to `globalThis.crypto.subtle`. */
  subtle?: SubtleCrypto;
  /**
   * Composable Subtle decorators layered over the host, in order, to add the
   * algorithms the keystore needs. Defaults (via core) to the full set of
   * bundled shims (BIP32-Ed25519, Falcon-1024, Deterministic-P256, BIP39 and
   * Algo25). Pass an explicit array (including `[]`) to override.
   */
  shims?: SubtleShim[];
  /**
   * OS-keychain binding holding secret material + the metadata master key.
   * Defaults to {@link createNapiKeyring} (backed by `@napi-rs/keyring`).
   * Injectable for tests or alternative secure stores.
   */
  keyring?: KeyringBinding;
  /**
   * Sealed-metadata file store. Defaults to a filesystem store at
   * `~/.algorand-keystore/metadata.bin` (see `createFileMetadataStore`).
   */
  metadata?: MetadataFile;
  /** OS-keychain service every entry is filed under (default keyring only). */
  service?: string;
  /** Path of the sealed metadata file (default filesystem store only). */
  metadataPath?: string;
  /**
   * Optional hook collection bound at creation. When provided, every
   * material-touching operation is interceptable via `before`/`after` hooks and
   * is exposed as `keystore.hooks`.
   */
  hooks?: HookCollection<any>;
}

/**
 * The Node.js keystore: the shared {@link KeyStore} (a `KeyStoreAPI` plus a
 * `ready` promise) backed by the OS keychain. The keychain access is
 * non-interactive, so its per-operation context is `void`.
 */
export type NodeKeyStore = KeyStore<void>;

/**
 * Creates a Node.js keystore backed by the OS keychain and the core composable
 * Subtle shims.
 *
 * Because the keychain is a byte store, every key (standard, HD root, Falcon and
 * seeds alike) is serialized to bytes and stored in the keychain, which provides
 * the encryption at rest; oversized material (e.g. Falcon-1024 private keys) is
 * chunked across numbered entries to stay under platform per-entry caps. All
 * key metadata is kept in one AES-GCM sealed file keyed by a small master key
 * held in the keychain. The reactive `store` mirrors only UI-safe metadata.
 *
 * @param options - {@link NodeKeyStoreOptions}.
 * @returns A {@link NodeKeyStore} (a `KeyStoreAPI` plus a `ready` promise).
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createNodeKeyStore } from "@algorandfoundation/keystore-node";
 *
 * const store = new Store({ keys: [], status: "idle" });
 * const keystore = createNodeKeyStore({ store });
 * await keystore.ready;
 *
 * const id = await keystore.generate({
 *   type: "ed25519",
 *   algorithm: "EdDSA",
 *   extractable: false,
 *   keyUsages: ["sign", "verify"],
 * });
 * const signature = await keystore.sign(id, new TextEncoder().encode("hi"));
 * ```
 */
export function createNodeKeyStore(options: NodeKeyStoreOptions): NodeKeyStore {
  const host = options.subtle ?? globalThis.crypto.subtle;
  const keyring = options.keyring ?? createNapiKeyring({ service: options.service });
  const metadata = options.metadata ?? createFileMetadataStore({ path: options.metadataPath });
  const driver = createKeychainDriver({ keyring, metadata, subtle: host });
  return createKeyStore<void>({
    driver,
    store: options.store,
    subtle: host,
    shims: options.shims,
    hooks: options.hooks,
  });
}
