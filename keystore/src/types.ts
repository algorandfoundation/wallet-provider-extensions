/**
 * Main interface for keystore operations. This defines what a keystore backend must do.
 * Think of it as a "key manager" that can create, store, and use cryptographic keys.
 *
 * Use cases:
 * - Generate keys for signing blockchain transactions.
 * - Import keys from external sources (e.g., other wallets).
 * - Derive new keys from a master seed for HD wallets.
 * - Sign data with private keys and verify signatures with public keys.
 */
export interface KeyStoreBackend {
	/**
	 * Creates a new key pair. This generates both a private key (secret) and public key (shareable).
	 * @param options - Specifies key type (e.g., RSA), algorithm, and size.
	 * @returns Unique ID of the generated key.
	 *
	 * Crypto note: Private key is used for signing and decryption; public key for verification and encryption (where applicable).
	 * Use case: Create a new key for a user's wallet address.
	 */
	generate(options: GenerateOptions): Promise<KeyId>;

	/**
	 * Imports an existing key into the keystore.
	 * @param data - The key data to import.
	 * @param format - How the key is encoded (e.g., PEM for text format).
	 * @returns Unique ID of the imported key.
	 *
	 * Use case: Import a public key from a certificate or private key from backup.
	 */
	import(data: KeyData, format: KeyFormat): Promise<KeyId>;

	/**
	 * Exports a key from the keystore (usually public key only, for security).
	 * @param id - Key ID to export.
	 * @param options - Export format options.
	 * @returns The key data.
	 *
	 * Crypto note: Never export private keys unless absolutely necessary (e.g., backups).
	 * Use case: Share public key for others to verify your signatures.
	 */
	export(id: KeyId, options?: ExportOptions): Promise<KeyData>;

	/**
	 * Deletes a key from the keystore.
	 * @param id - Key ID to remove.
	 *
	 * Use case: Clean up old or compromised keys.
	 */
	remove(id: KeyId): Promise<void>;

	/**
	 * Lists all keys in the keystore.
	 * @returns Metadata for all keys.
	 *
	 * Use case: Show user their available keys in a wallet app.
	 */
	list(): Promise<KeyMetadata[]>;

	/**
	 * Gets details about a specific key.
	 * @param id - Key ID.
	 * @returns Key metadata.
	 *
	 * Use case: Check key type or creation date.
	 */
	getMetadata(id: KeyId): Promise<KeyMetadata>;

	/**
	 * Signs data with a private key. This proves the data came from you.
	 * @param id - Key ID to use for signing.
	 * @param data - Data to sign (e.g., transaction bytes).
	 * @param algorithm - Optional algorithm override.
	 * @returns Digital signature.
	 *
	 * Crypto note: Signing uses the private key; anyone with public key can verify.
	 * Use case: Sign a blockchain transaction to authorize it.
	 */
	sign(id: KeyId, data: Uint8Array, algorithm?: string): Promise<Uint8Array>;

	/**
	 * Verifies a signature against data using a public key.
	 * @param id - Key ID (must have public key).
	 * @param data - Original data.
	 * @param signature - Signature to check.
	 * @param algorithm - Optional algorithm override.
	 * @returns True if signature is valid.
	 *
	 * Crypto note: Verification ensures data wasn't tampered with and came from key owner.
	 * Use case: Check if a received transaction is authentic.
	 */
	verify(
		id: KeyId,
		data: Uint8Array,
		signature: Uint8Array,
		algorithm?: string,
	): Promise<boolean>;

	/**
	 * Encrypts data with a public key (asymmetric encryption).
	 * @param id - Key ID.
	 * @param data - Data to encrypt.
	 * @param algorithm - Encryption algorithm.
	 * @returns Encrypted data.
	 *
	 * Crypto note: Only the private key holder can decrypt.
	 * Use case: Encrypt a message for someone else's public key.
	 */
	encryptWithKey?(
		id: KeyId,
		data: Uint8Array,
		algorithm?: string,
	): Promise<Uint8Array>;

	/**
	 * Decrypts data with a private key.
	 * @param id - Key ID.
	 * @param data - Encrypted data.
	 * @param algorithm - Decryption algorithm.
	 * @returns Decrypted data.
	 *
	 * Use case: Decrypt a message sent to you.
	 */
	decryptWithKey?(
		id: KeyId,
		data: Uint8Array,
		algorithm?: string,
	): Promise<Uint8Array>;

	/**
	 * Derives a shared secret for key agreement (e.g., ECDH).
	 * @param id - Your private key ID.
	 * @param publicKey - Other party's public key.
	 * @param algorithm - Key agreement algorithm.
	 * @returns Shared secret.
	 *
	 * Crypto note: Both parties get same secret without sharing private keys.
	 * Use case: Establish secure communication channel.
	 */
	deriveSharedSecret?(
		id: KeyId,
		publicKey: Uint8Array,
    meFirst: boolean,
		algorithm?: string,
	): Promise<Uint8Array>;

	/**
	 * Imports a raw seed (64 bytes / 512 bits) for HD wallets.
	 * @param seed - Seed bytes (from BIP39 or other sources).
	 * @param options - Import options.
	 * @returns Seed key ID.
	 *
	 * Crypto note: Seed is the root for deriving many keys.
	 * Use case: Import seed from user input or hardware wallet.
	 */
	importSeed?(seed: Uint8Array, options?: KeyOptions): Promise<KeyId>;

	/**
	 * Derives a new key from a seed using HD derivation path.
	 * @param seedId - Seed key ID.
	 * @param path - Derivation path (e.g., "m/44'/283'/0'/0/0").
	 * @param options - Derivation options.
	 * @returns Derived key ID.
	 *
	 * Crypto note: Creates child keys without exposing seed.
	 * Use case: Generate addresses for different accounts.
	 */
	deriveFromSeed?(
		seedId: KeyId,
		path: string,
		options?: DeriveOptions,
	): Promise<KeyId>;

	/**
	 * Encrypts arbitrary data (not key-related).
	 * @param data - Data to encrypt.
	 * @param passphrase - User password.
	 * @returns Encrypted data.
	 *
	 * Use case: Encrypt sensitive files with a passphrase.
	 */
	encryptData?(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

	/**
	 * Decrypts data.
	 * @param data - Encrypted data.
	 * @param passphrase - Password.
	 * @returns Decrypted data.
	 *
	 * Use case: Decrypt files you encrypted earlier.
	 */
	decryptData?(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

	/**
	 * Logs an audit event.
	 * @param event - Event details.
	 *
	 * Use case: Track key usage for compliance.
	 */
	logAuditEvent?(event: AuditEvent): Promise<void>;

	/**
	 * Gets audit logs.
	 * @param filter - Filter options.
	 * @returns List of events.
	 *
	 * Use case: Review key usage history.
	 */
	getAuditLogs?(filter?: {
		since?: Date;
		operation?: string;
	}): Promise<AuditEvent[]>;

	/**
	 * Signs multiple data items at once.
	 * @param ids - Key IDs.
	 * @param data - Data array.
	 * @returns Signature array.
	 *
	 * Use case: Batch sign multiple transactions.
	 */
	batchSign?(ids: KeyId[], data: Uint8Array[]): Promise<Uint8Array[]>;
}

/**
 * Configuration for the keystore. This controls how it behaves (e.g., enable logging, set limits).
 */
export interface KeyStoreConfig {
	/** Which backend to use for operations */
	backend?: KeyStoreBackend;
	/** Turn on basic auditing */
	enableAudit?: boolean;
	/** How to handle data encryption */
	encryption?: EncryptionConfig;
}

/**
 * Audit event for logging key operations.
 *
 * Use case: Track when keys were used for compliance reports.
 */
export interface AuditEvent {
	/** Event ID */
	id: string;
	/** When it happened */
	timestamp: Date;
	/** What operation (e.g., "sign") */
	operation: string;
	/** Key involved */
	keyId?: KeyId;
	/** Who did it */
	principal?: string;
	/** Did it succeed? */
	success: boolean;
	/** Extra details */
	details?: Record<string, any>;
	/** Tamper-proof hash */
	hmac?: string;
}

/**
 * Configuration for data encryption.
 */
export interface EncryptionConfig {
	/** Algorithm for encrypting data (e.g., 'aes-256-gcm') */
	algorithm?: "aes-256-gcm" | "chacha20-poly1305";
	/** How to derive keys from passphrases (e.g., 'pbkdf2') */
	keyDerivation?: "pbkdf2" | "argon2";
	/** Require passphrase for sensitive ops */
	requirePassphrase?: boolean;
}

/**
 * Core types for keys.
 */

/** Unique identifier for a key */
export type KeyId = string;

/** Type of key: RSA (asymmetric), ECC (elliptic curve), HD seed/derived */
export type KeyType = "rsa" | "ecc" | "lattice" | "hd-seed" | "hd-derived";

/** How keys are encoded: raw bytes, PEM (text), DER (binary), JWK (JSON), OpenPGP */
export type KeyFormat = "raw" | "pem" | "der" | "jwk" | "openpgp";

/** Supported algorithms: RS256 (RSA), ES256 (ECDSA), EdDSA (Ed25519) */
export type Algorithm = "RS256" | "ES256" | "EdDSA";

/**
 * Metadata about a key.
 *
 * Use case: Store info like when key was created or what it's for.
 */
export interface KeyMetadata {
	/** Key ID */
	id: KeyId;
	/** Key type */
	type: KeyType;
	/** Algorithm used */
	algorithm: Algorithm;
	/** Creation timestamp */
	createdAt: Date;
	/** API version for compatibility tracking */
	version?: number;
	/** Custom labels (e.g., {"purpose": "signing"}) */
	labels?: Record<string, string>;
	/** Custom extension data */
	customData?: Record<string, unknown>;
}

/**
 * Data for a key, including public key and metadata.
 */
export interface KeyData {
	/** Public key bytes (if available) */
	publicKey?: Uint8Array;
	/** Private key bytes (for import only, never exported) */
	privateKey?: Uint8Array;
	/** Key metadata */
	metadata: KeyMetadata;
}

/**
 * Options for generating a new key.
 */
export interface GenerateOptions {
	/** Key type */
	type: KeyType;
	/** Algorithm */
	algorithm: Algorithm;
	/** Key size in bits (e.g., 2048 for RSA) */
	keySize?: number;
	/** Curve for ECC (e.g., 'P-256') */
	curve?: string;
	/** Additional params */
	params?: Record<string, any>;
}

/**
 * Options for exporting a key.
 */
export interface ExportOptions {
	/** Export format */
	format: KeyFormat;
}

/**
 * Options for key operations.
 */
export interface KeyOptions {
	/** Custom ID */
	id?: string;
	/** Name/label */
	name?: string;
	/** Algorithm */
	algorithm?: Algorithm;
	/** Passphrase for encryption */
	passphrase?: string;
	/** Extra metadata */
	metadata?: Record<string, any>;
}

/**
 * Options for deriving keys from seed.
 */
export interface DeriveOptions extends KeyOptions {
	/** Algorithm for the derived key */
	algorithm: Algorithm;
	/** Curve for derived key (secp256k1, secp256r1, ed25519) */
	curve?: "secp256k1" | "secp256r1" | "ed25519";

	mode?: "standard" | "peikert" | "slip10";

	/** For P256 domain-specific derivation (WebAuthn/passkeys) */
	origin?: string;
	/** For P256 domain-specific derivation (WebAuthn/passkeys) */
	userHandle?: string;
	/** Counter for multiple keys per domain (default: 0) */
	counter?: number;
}

/**
 * Base error class for keystore operations.
 */
export class KeyStoreError extends Error {
	constructor(
		message: string,
		public readonly name: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = name;
		if (cause) {
			this.cause = cause;
		}
		Object.setPrototypeOf(this, KeyStoreError.prototype);
	}
}

/**
 * Specific keystore errors.
 */
export class KeyNotFoundError extends KeyStoreError {
	constructor(keyId: string, cause?: Error) {
		super(`Key not found: ${keyId}`, "KeyNotFoundError", cause);
		Object.setPrototypeOf(this, KeyNotFoundError.prototype);
	}
}

export class KeyGenerationNotSupportedError extends KeyStoreError {
	constructor(algorithm: string, cause?: Error) {
		super(
			`Key generation not supported for algorithm: ${algorithm}`,
			"KeyGenerationNotSupportedError",
			cause,
		);
		Object.setPrototypeOf(this, KeyGenerationNotSupportedError.prototype);
	}
}

export class InvalidKeyFormatError extends KeyStoreError {
	constructor(format: string, cause?: Error) {
		super(`Invalid key format: ${format}`, "InvalidKeyFormatError", cause);
		Object.setPrototypeOf(this, InvalidKeyFormatError.prototype);
	}
}

export class DuplicateKeyIdError extends KeyStoreError {
	constructor(keyId: string, cause?: Error) {
		super(`Duplicate key ID: ${keyId}`, "DuplicateKeyIdError", cause);
		Object.setPrototypeOf(this, DuplicateKeyIdError.prototype);
	}
}

export class InvalidKeyDataError extends KeyStoreError {
	constructor(reason: string, cause?: Error) {
		super(`Invalid key data: ${reason}`, "InvalidKeyDataError", cause);
		Object.setPrototypeOf(this, InvalidKeyDataError.prototype);
	}
}

export interface StoredKeyData {
	metadata: KeyMetadata;
	publicKey: Uint8Array;
	privateKey?: Uint8Array;
	derivationPath?: number[];
	context?: number;
	account?: number;
	keyIndex?: number;
	curve?: "ed25519" | "secp256r1";
}

export interface StoredSeedData {
	metadata: KeyMetadata;
	rootKey: Uint8Array;
	derivedMainKey?: Uint8Array;
}

export interface KeyStorage {
	get(id: KeyId): Promise<StoredKeyData>;
	set(id: KeyId, data: StoredKeyData): Promise<void>;
	delete(id: KeyId): Promise<boolean>;
	list(): Promise<KeyId[]>;
	getAll(): Promise<StoredKeyData[]>;
}

export interface SeedStorage {
	get(id: KeyId): Promise<StoredSeedData>;
	set(id: KeyId, data: StoredSeedData): Promise<void>;
	delete(id: KeyId): Promise<boolean>;
	list(): Promise<KeyId[]>;
	getAll(): Promise<StoredSeedData[]>;
}

export interface AuditStorage {
	append(event: AuditEvent): Promise<void>;
	list(filter?: { since?: Date; operation?: string }): Promise<AuditEvent[]>;
	clear(): Promise<void>;
}
