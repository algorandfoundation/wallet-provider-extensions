// Library Requirements

import type { DeterministicP256 } from "@algorandfoundation/dp256";
import type {
	Secret,
	SecretId,
	SecretStoreExtension,
} from "@algorandfoundation/secret-store";
// Framework Components
import type {
	ExtensionOptions,
	Provider,
} from "@algorandfoundation/wallet-provider";
import type { XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
import type * as bip39 from "@scure/bip39";

// The reactive state of the store (our reflection to the outside world)
export interface KeyStoreState {
	keys: Key[];
	activeKey: Key | null;
}

// What we are exporting to the wallet provider (our mutations to the provider)
export interface KeyStoreExtension extends KeyStoreState {
	crypto: {
		bip39: typeof bip39;
		xhd: XHDWalletAPI;
		dp256: DeterministicP256;
	};
	keystore: KeyStoreApi;
}

// Strongly typed context for this extension (what the provider should contain in this extension)
export type KeyStoreContext = Provider<any> & SecretStoreExtension;

// Custom Keystore Options, this could include passing the store in the future.
export type KeyStoreExtensionOptions = ExtensionOptions;

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
export interface KeyStoreApi {
	/**
	 * Creates a new key pair. This generates both a private key (secret) and public key (shareable).
	 * @param options - Specifies key type (e.g., RSA), algorithm, and size.
	 * @returns Unique ID of the generated key.
	 *
	 * Crypto note: Private key is used for signing and decryption; public key for verification and encryption (where applicable).
	 * Use case: Create a new key for a user's wallet address.
	 */
	generate(options: GenerateOptions): Promise<Key>;

	/**
	 * Imports an existing key into the keystore.
	 * @param data - The key data to import.
	 * @param format - How the key is encoded (e.g., PEM for text format).
	 * @returns Unique ID of the imported key.
	 *
	 * Use case: Import a public key from a certificate or private key from backup.
	 */
	import(data: Key, format: KeyFormat): Promise<Key>;

	/**
	 * Exports a key from the keystore (usually public key only, for security).
	 * @param id - Key ID to export.
	 * @param options - Export format options.
	 * @returns The key data.
	 *
	 * Crypto note: Never export private keys unless absolutely necessary (e.g., backups).
	 * Use case: Share public key for others to verify your signatures.
	 */
	export(id: KeyId, options?: ExportOptions): Promise<Key>;

	/**
	 * Deletes a key from the keystore.
	 * @param id - Key ID to remove.
	 *
	 * Use case: Clean up old or compromised keys.
	 */
	remove(id: KeyId): Promise<void>;

	/**
	 * Signs data with a private key. This proves the data came from you.
	 * @param id - Key ID to use for signing.
	 * @param data - Data to sign (e.g., transaction bytes).
	 * @returns Digital signature.
	 *
	 * Crypto note: Signing uses the private key; anyone with public key can verify.
	 * Use case: Sign a blockchain transaction to authorize it.
	 */
	sign(id: KeyId, data: Uint8Array): Promise<Uint8Array>;

	/**
	 * Verifies a signature against data using a public key.
	 * @param id - Key ID (must have public key).
	 * @param data - Original data.
	 * @param signature - Signature to check.
	 * @returns True if signature is valid.
	 *
	 * Crypto note: Verification ensures data wasn't tampered with and came from key owner.
	 * Use case: Check if a received transaction is authentic.
	 */
	verify(id: KeyId, data: Uint8Array, signature: Uint8Array): Promise<boolean>;

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
	encryptWithKey(
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
	decryptWithKey(
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
	deriveSharedSecret(
		id: KeyId,
		publicKey: Uint8Array,
		algorithm?: string,
	): Promise<Uint8Array>;

	/**
	 * Imports a raw seed (64 bytes / 512 bits) for HD wallets.
	 * @param secret - Seed value from Secrets store (from BIP39 or other sources).
	 * @param key - Import options for the newly generated key
	 *
	 * Crypto note: Seed is the root for deriving many keys.
	 * Use case: Import seed from user input or hardware wallet.
	 */
	importSeed(secret: Secret, key: Key): Promise<KeyId>;

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
	deriveFromSeed(
		seedId: SecretId,
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
	encryptData(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

	/**
	 * Decrypts data.
	 * @param data - Encrypted data.
	 * @param passphrase - Password.
	 * @returns Decrypted data.
	 *
	 * Use case: Decrypt files you encrypted earlier.
	 */
	decryptData(data: Uint8Array, passphrase?: string): Promise<Uint8Array>;

	/**
	 * Signs multiple data items at once.
	 * @param ids - Key IDs.
	 * @param data - Data array.
	 * @returns Signature array.
	 *
	 * Use case: Batch sign multiple transactions.
	 */
	batchSign(ids: KeyId[], data: Uint8Array[]): Promise<Uint8Array[]>;
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
export type KeyType =
	| "rsa"
	| "ecc"
	| "lattice"
	| "hd-seed"
	| "hd-derived"
	| string;

/** How keys are encoded: raw bytes, PEM (text), DER (binary), JWK (JSON), OpenPGP */
export type KeyFormat = "raw" | "pem" | "der" | "jwk" | "openpgp" | string;

/** Supported algorithms: RS256 (RSA), ES256 (ECDSA), EdDSA (Ed25519) */
export type Algorithm = "RS256" | "ES256" | "EdDSA" | string;

/**
 * Data for a key, including public key and metadata.
 */
export interface Key {
	/** Key ID */
	id: KeyId;
	/** Key type */
	type: KeyType;
	/** Algorithm used */
	algorithm: Algorithm;
	/** Public key bytes (if available) */
	publicKey?: Uint8Array;
	/** Private key bytes (for import only, never exported) */
	privateKey?: Uint8Array;
	/** Secret ID (if the key is associated with a secret) */
	secretId?: SecretId;
	/** Key metadata */
	metadata: Record<string, any>;
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
 * @todo: Refactor this into Key since we can use Omit<Key, 'id'> or Partial<Key> for working with shapes
 */
export interface KeyOptions {
	/** Custom ID */
	id?: string;
	/** Key type */
	type: KeyType;
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
 * @todo: Refactor dependencies of this type to be the types of concrete keys (xhd, ed25519).
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
	/** Passphrase to use with algorithms that support it **/
	passphrase?: string;
}
