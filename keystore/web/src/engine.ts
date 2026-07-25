/**
 * The browser keystore engine.
 *
 * This is now a thin wrapper: it builds an IndexedDB {@link KeyStoreDriver} and
 * hands it to the shared, platform-neutral {@link createKeyStore} orchestrator
 * in `@algorandfoundation/keystore-core`. All the crypto orchestration
 * (metadata mirroring, just-in-time material decrypt, shim injection) lives in
 * core and is shared with every other backend; this package only supplies the
 * IndexedDB persistence.
 */

import {
  createKeyStore,
  type KeyStore,
  type KeyStoreState,
  type SubtleShim,
} from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import { createIndexedDBDriver } from "./storage/driver.ts";

/**
 * Options for {@link createWebKeyStore}.
 */
export interface WebKeyStoreOptions {
  /** Reactive store that mirrors the persisted metadata (never private material). */
  store: Store<KeyStoreState>;
  /**
   * Composable Subtle decorators layered over the host, in order, to add the
   * algorithms the keystore needs (e.g. `(host) => withSubtleXHD(host, xhd)`,
   * `(host) => withSubtleFalcon1024(host, falcon)`). Injected this way, the
   * engine stays free of a hard dependency on any specific primitive binding.
   */
  shims?: SubtleShim[];
  /** Host Subtle implementation; defaults to `globalThis.crypto.subtle`. */
  subtle?: SubtleCrypto;
  /** IndexedDB factory; defaults to `globalThis.indexedDB`. Injectable for tests. */
  indexedDB?: IDBFactory;
  /** Database name; defaults to `"keystore"`. */
  databaseName?: string;
  /**
   * Optional hook collection bound at creation. When provided, every
   * material-touching operation is interceptable via `before`/`after` hooks and
   * is exposed as `keystore.hooks`. This is how the Wallet Provider
   * `WithKeyStore` extension threads its hooks into the engine.
   */
  hooks?: HookCollection<any>;
}

/**
 * The browser keystore: the shared {@link KeyStore} (a `KeyStoreAPI` plus a
 * `ready` promise) backed by IndexedDB. The IndexedDB driver is non-interactive,
 * so its per-operation context is `void`.
 */
export type WebKeyStore = KeyStore<void>;

/**
 * Creates a browser keystore backed by IndexedDB and the core composable Subtle
 * shims.
 *
 * Standard host keys (Ed25519, AES, …) are persisted as non-extractable
 * {@link CryptoKey}s so their private bytes never live in JS. Shim keys
 * (BIP32-Ed25519 roots, Falcon private keys) and raw seeds are stored as bytes
 * encrypted at rest with a non-extractable AES-GCM master key. The reactive
 * `store` mirrors only UI-safe metadata.
 *
 * @param options - {@link WebKeyStoreOptions}.
 * @returns A {@link WebKeyStore} (a `KeyStoreAPI` plus a `ready` promise).
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import * as falcon from "falcon-1024";
 * import { withSubtleXHD, withSubtleFalcon1024 } from "@algorandfoundation/keystore-core";
 * import { fromSeed, XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
 *
 * const store = new Store({ keys: [], status: "idle" });
 * const api = new XHDWalletAPI();
 * const xhd = {
 *   fromSeed: (seed) => fromSeed(Buffer.from(seed)),
 *   deriveKey: (r, p, isPriv, d) => api.deriveKey(r, p, isPriv, d),
 *   rawSign: (r, p, data, d) => (api as any).rawSign(r, p, data, d),
 *   verifyWithPublicKey: (sig, msg, pk) => api.verifyWithPublicKey(sig, msg, pk),
 * };
 * const keystore = createWebKeyStore({
 *   store,
 *   shims: [(host) => withSubtleXHD(host, xhd), (host) => withSubtleFalcon1024(host, falcon)],
 * });
 * await keystore.ready;
 *
 * const seedId = await keystore.importSeed!(bip39Seed);
 * const rootId = await keystore.generate({
 *   type: "hd-root-key",
 *   algorithm: "raw",
 *   extractable: false,
 *   keyUsages: ["sign"],
 *   params: { parentKeyId: seedId },
 * });
 * const acctId = await keystore.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");
 * const sig = await keystore.sign(acctId, new TextEncoder().encode("hi"));
 * ```
 */
export function createWebKeyStore(options: WebKeyStoreOptions): WebKeyStore {
  const host = options.subtle ?? globalThis.crypto.subtle;
  const driver = createIndexedDBDriver({
    host,
    indexedDB: options.indexedDB,
    databaseName: options.databaseName,
  });
  return createKeyStore<void>({
    driver,
    store: options.store,
    subtle: host,
    shims: options.shims,
    hooks: options.hooks,
  });
}
