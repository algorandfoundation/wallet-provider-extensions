import type {
  AuditEvent,
  DeriveOptions,
  ExportOptions,
  GenerateOptions,
  Key,
  KeyData,
  KeyFormat,
  KeyId,
  KeyOptions,
} from "./core.ts";
import type { KeyStoreState } from "./extension.ts";

/**
 * Options for storing a secret via {@link SecretStoreAPI.put}.
 */
export interface SecretOptions {
  /** Custom id for the secret; a random UUID is assigned when omitted. */
  id?: KeyId;
  /** Human-readable label. */
  name?: string;
  /** Arbitrary, non-secret metadata mirrored into the reactive store. */
  metadata?: Record<string, unknown>;
}

/**
 * A small key/value interface on the keystore for **secrets**: arbitrary,
 * user-provided values (API tokens, opaque blobs, …) that have no intrinsic
 * cryptographic purpose (`keyUsages: []`). Secrets are sealed at rest through
 * the same {@link import("./driver.ts").KeyStoreDriver} as key material, and
 * only their non-secret metadata is mirrored into the reactive store.
 *
 * Unlike private key material — which never crosses the public surface —
 * secrets are meant to be read back: {@link get} returns the decrypted
 * plaintext value. This deliberate exception is what makes secrets useful as a
 * general-purpose, application-controlled store ("save them however we want").
 *
 * @typeParam Ctx - The backend's per-operation context (e.g. a biometric unlock
 *   prompt), threaded verbatim to the driver.
 */
export interface SecretStoreAPI<Ctx = unknown> {
  /**
   * Stores `value` (text is UTF-8 encoded) sealed at rest.
   *
   * @param value - The secret payload.
   * @param options - Optional id/name/metadata.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyId} the secret is stored under.
   */
  put(value: Uint8Array | string, options?: SecretOptions, ctx?: Ctx): Promise<KeyId>;

  /**
   * Reads back a secret's decrypted plaintext value.
   *
   * @param id - The {@link KeyId} of the secret.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The plaintext bytes.
   * @throws {KeyNotFoundError} If no secret exists for `id`.
   */
  get(id: KeyId, ctx?: Ctx): Promise<Uint8Array>;

  /**
   * Lists the metadata of every stored secret (never the values).
   */
  list(): Promise<Key[]>;

  /**
   * Deletes a secret.
   *
   * @param id - The {@link KeyId} of the secret to delete.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   */
  remove(id: KeyId, ctx?: Ctx): Promise<void>;
}

/**
 * Main interface for keystore operations. This defines what a keystore backend must do.
 * Think of it as a "key manager" that can create, store, and use cryptographic keys.
 *
 * Use cases:
 * - Generate keys for signing arbitrary data.
 * - Import keys from external sources (e.g., other wallets).
 * - Derive new keys from a master seed for HD wallets.
 * - Sign data with private keys and verify signatures with public keys.
 *
 * @see {@link KeyStoreState} for the reactive state representation of the keystore.
 *
 * @typeParam Ctx - The backend's per-operation context (e.g. an auth prompt /
 *   cancellation signal for an interactive, biometric-gated backend). It is
 *   threaded verbatim through every material-touching method and is opaque to
 *   portable callers, which leave it `undefined`. `verify` is intentionally
 *   context-free — it only touches the public key and never unlocks.
 */
export interface KeyStoreAPI<Ctx = unknown> {
  /**
   * Creates a new key pair. This generates both a private key (secret) and public key (shareable).
   *
   * @param options - Generation parameters including {@link KeyType} and {@link Algorithm}.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The unique {@link KeyId} of the generated key.
   */
  generate(options: GenerateOptions, ctx?: Ctx): Promise<KeyId>;

  /**
   * Imports an existing key into the keystore.
   *
   * `data.id`, when supplied, is used as-is instead of minting a random
   * {@link KeyId} — useful for migrating a key that must keep a caller-known
   * id (e.g. re-importing a standalone Ed25519 private key under the id it
   * was previously known by). If an entry already exists under that id, it is
   * replaced: this is the desired behaviour for migrations, not a merge.
   *
   * @param data - The raw key data to import, with an optional caller-supplied `id`.
   * @param format - The {@link KeyFormat} of the provided data.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyId} assigned to the imported key (`data.id` when supplied).
   * @throws {InvalidKeyFormatError} If the format is invalid.
   * @throws {InvalidKeyDataError} If the key data is malformed.
   */
  import(
    data: (Omit<KeyData, "id"> & { id?: KeyId }) | Uint8Array | string,
    format?: KeyFormat,
    ctx?: Ctx,
  ): Promise<KeyId>;

  /**
   * Exports a key from the keystore (usually public key only, for security).
   *
   * @param id - The {@link KeyId} of the key to export.
   * @param options - Export options such as {@link KeyFormat}.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyData} containing exported key material.
   */
  export(id: KeyId, options?: ExportOptions, ctx?: Ctx): Promise<KeyData>;

  /**
   * Deletes a key from the keystore.
   *
   * @param id - The {@link KeyId} of the key to delete.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @throws {KeyNotFoundError} If the key is not found.
   */
  remove(id: KeyId, ctx?: Ctx): Promise<void>;

  /**
   * Removes **every** key from the keystore (both persisted material and the
   * reactive metadata). Optional — only available when the backing
   * {@link import("./driver.ts").KeyStoreDriver} supports a bulk clear.
   *
   * @param ctx - Optional backend-specific context (unlock/authorization).
   */
  clear?(ctx?: Ctx): Promise<void>;

  /**
   * Signs data with a private key.
   *
   * @param id - The {@link KeyId} to use for signing.
   * @param data - The data to sign.
   * @param algorithm - Optional override for the signing algorithm.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The resulting signature.
   * @throws {KeyNotFoundError} If the key is not found.
   */
  sign(id: KeyId, data: Uint8Array, algorithm?: string, ctx?: Ctx): Promise<Uint8Array>;

  /**
   * Verifies a signature against data using a public key.
   *
   * @param id - The {@link KeyId} to use for verification.
   * @param data - The original data that was signed.
   * @param signature - The signature to verify.
   * @param algorithm - Optional override for the verification algorithm.
   * @returns True if the signature is valid, false otherwise.
   */
  verify(id: KeyId, data: Uint8Array, signature: Uint8Array, algorithm?: string): Promise<boolean>;

  /**
   * Encrypts data with a public key (asymmetric encryption).
   *
   * @param id - The {@link KeyId} to use for encryption.
   * @param data - The data to encrypt.
   * @param algorithm - Optional override for the encryption algorithm.
   * @returns The encrypted data.
   */
  encryptWithKey?(id: KeyId, data: Uint8Array, algorithm?: string, ctx?: Ctx): Promise<Uint8Array>;

  /**
   * Decrypts data with a private key.
   *
   * @param id - The {@link KeyId} to use for decryption.
   * @param data - The data to decrypt.
   * @param algorithm - Optional override for the decryption algorithm.
   * @returns The decrypted data.
   */
  decryptWithKey?(id: KeyId, data: Uint8Array, algorithm?: string, ctx?: Ctx): Promise<Uint8Array>;

  /**
   * Derives a shared secret for key agreement (e.g., ECDH).
   *
   * @param id - The local {@link KeyId} to use.
   * @param publicKey - The remote public key.
   * @param meFirst - Order of keys in derivation.
   * @param algorithm - Optional override for the derivation algorithm.
   * @returns The derived shared secret.
   */
  deriveSharedSecret?(
    id: KeyId,
    publicKey: Uint8Array,
    meFirst: boolean,
    algorithm?: string,
    ctx?: Ctx,
  ): Promise<Uint8Array>;

  /**
   * Imports raw seed bytes for HD wallets.
   *
   * Accepts seed **bytes only**. A BIP39 mnemonic must be converted to seed
   * bytes at the call site (e.g. `bip39.mnemonicToSeed`) so the mnemonic
   * string never crosses into the keystore — an immutable JS string can't be
   * wiped and would linger in the heap until GC.
   *
   * @param seed - The raw seed bytes.
   * @param options - Optional configuration for the seed.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyId} assigned to the seed.
   */
  importSeed?(seed: Uint8Array, options?: KeyOptions, ctx?: Ctx): Promise<KeyId>;

  /**
   * Derives a new key from a seed using HD derivation path.
   *
   * @param seedId - The {@link KeyId} of the seed to derive from.
   * @param path - The derivation path (e.g., "m/44'/283'/0'/0/0").
   * @param options - Additional {@link DeriveOptions}.
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyId} of the derived key.
   */
  deriveFromSeed?(seedId: KeyId, path: string, options?: DeriveOptions, ctx?: Ctx): Promise<KeyId>;

  /**
   * Derives a deterministic-P256 (passkey) domain key from a `pbkdf2-p256`
   * `hd-root-key` main key, along the `{ origin, userHandle, counter }`
   * descriptor carried by {@link DeriveOptions}.
   *
   * The derived key is recorded as metadata only (`storage: "none"`): its
   * private scalar is re-derived just-in-time from the persisted main key at
   * `sign` time and is never itself persisted. This is the deterministic-P256
   * analogue of {@link deriveFromSeed} (whose coordinate is a BIP44 path rather
   * than a domain descriptor).
   *
   * @param mainKeyId - The {@link KeyId} of the dp256 main key to derive from.
   * @param options - Domain descriptor (`origin`, `userHandle`, `counter`).
   * @param ctx - Optional backend-specific context (unlock/authorization).
   * @returns The {@link KeyId} of the derived passkey.
   */
  deriveDomainKey?(mainKeyId: KeyId, options: DeriveOptions, ctx?: Ctx): Promise<KeyId>;

  /**
   * Encrypts arbitrary data using a passphrase.
   *
   * @param data - The data to encrypt.
   * @param passphrase - The passphrase to use for encryption.
   * @returns The encrypted data.
   */
  encryptData?(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

  /**
   * Decrypts data using a passphrase.
   *
   * @param data - The data to decrypt.
   * @param passphrase - The passphrase used for encryption.
   * @returns The decrypted data.
   */
  decryptData?(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

  /**
   * Logs an audit event.
   *
   * @param event - The {@link AuditEvent} to log.
   */
  logAuditEvent?(event: AuditEvent): Promise<void>;

  /**
   * Gets audit logs.
   *
   * @param filter - Optional filters for the logs.
   * @returns An array of {@link AuditEvent} matches.
   */
  getAuditLogs?(filter?: { since?: Date; operation?: string }): Promise<AuditEvent[]>;

  /**
   * Signs multiple data items at once.
   *
   * @param ids - The {@link KeyId}s to use for each data item.
   * @param data - The data items to sign.
   * @returns An array of signatures.
   */
  batchSign?(ids: KeyId[], data: Uint8Array[], ctx?: Ctx): Promise<Uint8Array[]>;

  /**
   * A key/value store for **secrets** — arbitrary, application-controlled values
   * (API tokens, opaque blobs) with no cryptographic role. Sealed at rest via
   * the same driver as key material, but — unlike key material — readable back
   * in plaintext via {@link SecretStoreAPI.get}. See {@link SecretStoreAPI}.
   */
  secrets?: SecretStoreAPI<Ctx>;
}

// Note: XHDKeyStoreBackendOptions is defined in backend/xhd.ts
// to avoid duplicate exports
