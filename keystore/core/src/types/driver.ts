/**
 * The storage-driver contract that a platform backend implements so the shared
 * {@link import("../create.ts").createKeyStore} orchestrator can persist and
 * retrieve key material without knowing anything about *how* a given platform
 * stores it.
 *
 * A driver is a **material custodian**: it owns encrypted-at-rest persistence of
 * secret material plus the platform-specific unlock flow, and it stores the
 * UI-safe metadata for each key. The orchestrator stays crypto-only — it never
 * touches storage directly, only this contract.
 *
 * @remarks
 * The two axes along which real backends genuinely diverge are captured
 * first-class here so they can evolve without forking the contract:
 *
 * - {@link DriverCapabilities.nativeCryptoKey} — whether the backend can hold a
 *   non-extractable {@link CryptoKey} natively (IndexedDB can structured-clone
 *   one; a Keychain/MMKV byte store cannot and must serialize to sealed bytes).
 * - The generic **context** `Ctx` threaded through every material-touching
 *   method. It is opaque to the orchestrator; an interactive backend (React
 *   Native biometrics) types it as its own auth-prompt/cancellation options,
 *   while a non-interactive backend (IndexedDB) ignores it. This mirrors the
 *   "rely on a general type in core, bind differently per platform" rule the
 *   crypto shims already follow.
 */

import type { Key, KeyId } from "./core.ts";

/**
 * A secret to persist for a single key.
 *
 * - `cryptokey` — a genuine (typically non-extractable) {@link CryptoKey}. Only
 *   backends whose {@link DriverCapabilities.nativeCryptoKey} is `true` may be
 *   handed this variant, since the key must be persisted without ever becoming
 *   raw bytes in JS.
 * - `bytes` — plaintext secret bytes the driver must encrypt at rest before
 *   persisting (shim key material such as BIP32-Ed25519 roots and Falcon
 *   private keys, raw seeds, or serialized standard keys on byte-only
 *   backends). The orchestrator hands these to {@link KeyStoreDriver.put} and
 *   expects the driver to seal them; the driver may wipe the buffer once
 *   sealed.
 */
export type DriverMaterial =
  | { kind: "cryptokey"; privateKey: CryptoKey; publicKey?: CryptoKey }
  | { kind: "bytes"; bytes: Uint8Array };

/**
 * What a {@link KeyStoreDriver} can actually do. Callers (and the orchestrator)
 * branch on this instead of sniffing the runtime.
 */
export interface DriverCapabilities {
  /**
   * `true` when the backend can persist a non-extractable {@link CryptoKey}
   * natively (e.g. IndexedDB structured-clone). When `false`, standard-algorithm
   * keys must be serialized to sealed bytes — a slight downgrade the orchestrator
   * handles transparently.
   */
  readonly nativeCryptoKey: boolean;
  /**
   * `true` when {@link KeyStoreDriver.use} may trigger an interactive unlock
   * (biometric prompt, passcode fallback, …) and therefore may fail or be
   * cancelled. The per-operation `ctx` carries the prompt configuration.
   */
  readonly interactiveUnlock: boolean;
  /**
   * Free-form, additive list of the authentication factors the backend can
   * apply (e.g. `"biometrics"`, `"passcode-fallback"`, `"hardware-backed"`). A
   * backend can advertise a new factor without any change to core.
   */
  readonly authFactors: readonly string[];
}

/**
 * A material custodian for a single keystore.
 *
 * Implementations own encrypted-at-rest persistence of secret material and the
 * platform-specific unlock flow, plus persistence of UI-safe {@link Key}
 * metadata. The shared orchestrator drives one of these to fulfil the
 * {@link import("./backend.ts").KeyStoreAPI}.
 *
 * @typeParam Ctx - The backend's per-operation context (auth prompt,
 *   cancellation signal, …). Opaque to the orchestrator, which simply threads
 *   whatever the caller passed straight through. Defaults to `unknown`.
 */
export interface KeyStoreDriver<Ctx = unknown> {
  /** What this backend can do; the orchestrator branches on it. */
  readonly capabilities: DriverCapabilities;

  /**
   * Resolves once the driver is ready to serve requests (e.g. its database is
   * open). The orchestrator awaits this before hydrating and on every op.
   */
  readonly ready?: Promise<void>;

  /**
   * Persists {@link DriverMaterial} for `id`. Byte material must be encrypted at
   * rest before it is written; `CryptoKey` material is persisted as-is (only on
   * backends whose {@link DriverCapabilities.nativeCryptoKey} is `true`).
   *
   * @param id - The key id the material belongs to.
   * @param material - The secret to persist.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   */
  put(id: KeyId, material: DriverMaterial, ctx?: Ctx): Promise<void>;

  /**
   * Produces the persisted material for `id`, decrypted just-in-time, for a
   * single operation. This is where an interactive backend runs its unlock
   * prompt; `ctx` carries the prompt/cancellation and the driver may throw a
   * backend-specific error if unlock fails.
   *
   * The decrypted material lives only inside `fn`'s call frame; the driver
   * should wipe any decrypted byte buffer once `fn` settles.
   *
   * @param id - The key id whose material to open.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @param fn - Consumer invoked with the decrypted material.
   * @returns Whatever `fn` returns.
   */
  use<T>(
    id: KeyId,
    ctx: Ctx | undefined,
    fn: (material: DriverMaterial) => T | Promise<T>,
  ): Promise<T>;

  /**
   * Removes both the material and metadata persisted for `id`.
   *
   * @param id - The key id to remove.
   * @param ctx - Optional backend-specific context.
   */
  remove(id: KeyId, ctx?: Ctx): Promise<void>;

  /**
   * Removes **every** persisted key (material and metadata) owned by this
   * keystore. Optional: a backend that cannot bulk-clear may omit it, in which
   * case {@link import("./backend.ts").KeyStoreAPI.clear} is unavailable.
   *
   * @param ctx - Optional backend-specific context (unlock/authorization).
   */
  clear?(ctx?: Ctx): Promise<void>;

  /**
   * Persists (inserts or replaces) UI-safe {@link Key} metadata. Metadata never
   * contains private material, so it needs no unlock and no context.
   *
   * @param key - The metadata to persist.
   */
  putMeta(key: Key): Promise<void>;

  /**
   * Reads the metadata persisted for `id`, or `undefined` when absent.
   *
   * @param id - The key id to look up.
   */
  getMeta(id: KeyId): Promise<Key | undefined>;

  /** Reads every persisted metadata record (used to hydrate the reactive store). */
  listMeta(): Promise<Key[]>;
}
