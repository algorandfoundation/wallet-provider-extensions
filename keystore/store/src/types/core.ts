/**
 * Core types and interfaces for the keystore.
 * These are the fundamental types used throughout the system.
 */

/**
 * Unique identifier for a key
 */
export type KeyId = string;

/**
 * Type of key: RSA (asymmetric), Ed25519 (Edwards), P-256 (elliptic curve), HD seed/derived
 */
export type KeyType =
	| "ed25519"
	| "p256"
	| "lattice"
	| "hd-seed"
	| "hd-root-key"
	| "hd-derived-ed25519"
	| "hd-derived-p256"
	| string;

/**
 * How keys are encoded: raw bytes, PEM (text), DER (binary), JWK (JSON), OpenPGP
 */
export type KeyFormat = "raw" | "pem" | "der" | "jwk" | "openpgp" | "keydata" | "seed" | string;

// TODO: Align with formats from Subtle?
// export type ImportFormat =
// 	| 'raw'
// 	| 'raw-public'
// 	| 'raw-secret'
// 	| 'raw-seed'
// 	| 'pkcs8'
// 	| 'spki'
// 	| 'jwk';

/**
 * Supported algorithms:
 * - `RS256`: RSA PKCS#1 v1.5 with SHA-256
 * - `P256`: ECDSA using P-256 and SHA-256
 * - `EdDSA`: EdDSA using Ed25519
 * - `raw`: raw bytes (e.g., storing seed material)
 */
export type Algorithm = "RS256" | "P256" | "EdDSA" | "raw" | string;

// TODO: Align with SubtleCrypto algorithms and general options?
// export type SubtleAlgorithm = {
// 	name: AnyAlgorithm;
// 	salt?: string | BufferLike;
// 	iterations?: number;
// 	hash?: HashAlgorithm | string | { name: string };
// 	namedCurve?: NamedCurve;
// 	length?: number;
// 	modulusLength?: number;
// 	publicExponent?: number | Uint8Array;
// 	saltLength?: number;
// 	public?: CryptoKey;
// 	info?: BufferLike;
// 	// Argon2 parameters
// 	nonce?: BufferLike;
// 	parallelism?: number;
// 	tagLength?: number;
// 	memory?: number;
// 	passes?: number;
// 	secretValue?: BufferLike;
// 	associatedData?: BufferLike;
// 	version?: number;
// 	// KMAC parameters
// 	customization?: BufferLike;
// };
// export type AnyAlgorithm =
// 	| DigestAlgorithm
// 	| HashAlgorithm
// 	| KeyPairAlgorithm
// 	| SecretKeyAlgorithm
// 	| SignVerifyAlgorithm
// 	| DeriveBitsAlgorithm
// 	| EncryptDecryptAlgorithm
// 	| AESAlgorithm
// 	| 'PBKDF2'
// 	| 'HKDF'
// 	| 'unknown';

/**
 * Base key interface containing common metadata.
 */
export interface Key {
	id: KeyId;
	/**
	 * Key type.
	 */
	type: KeyType;
	/**
	 * Key algorithm.
	 */
	algorithm: Algorithm;
	/**
	 * Key usages.
	 */
	keyUsages?: KeyUsage[];
	/** Public key bytes (if available) */
	publicKey?: Uint8Array;
	/**
	 * Key format, if applicable.
	 */
	format?: KeyFormat;
	/** Whether the key can be extracted from the key store */
	extractable: boolean;
	/** Custom extension data for specific implementations */
	metadata?: Record<string, unknown>;
	/** API version for compatibility tracking */
	version?: number;

	// TODO: add useful methods that are bound to the key contexts (it has knowledge of it's own state):
	//sign?: (data: Uint8Array) => Promise<Uint8Array>;
	//verify?: (data: Uint8Array, signature: Uint8Array) => Promise<boolean>;
	//encrypt?: (data: Uint8Array) => Promise<Uint8Array>;
	//decrypt?: (data: Uint8Array) => Promise<Uint8Array>;
}

/**
 * Data for a key, including optional public key and metadata.
 */
export interface KeyData extends Key {
	/** Private key bytes (usually for import only, never exported for existing keys) */
	privateKey?: Uint8Array;
}

/**
 * Represents a Hierarchical Deterministic (HD) seed.
 */
export interface SeedData extends KeyData {
	type: "hd-seed";
	algorithm: "raw";
}

export function isSeedData(key: any): key is SeedData {
	return key?.type === "hd-seed";
}

/**
 * Represents an HD root key derived from a seed.
 */
export interface XHDRootKey extends KeyData {
	type: "hd-root-key";
	algorithm: "raw";
	metadata?: {
		/** Optional identifier of the parent key/seed */
		parentId?: string;
		/** Optional identifier of the root key/seed */
		rootKeyId?: string;
	};
}

export function isXHDRootKey(key: any): key is XHDRootKey {
	return key?.type === "hd-root-key";
}

/**
 * Represents metadata for a key derived via XHD (Extended HD) derivation.
 *
 * @remarks
 * This is primarily used for Ed25519 keys in the Algorand ecosystem.
 */
export interface XHDDerivedKeyData extends KeyData {
	type: "hd-derived-ed25519";
	algorithm: "EdDSA";
	metadata: {
		/** Address Mapping */
		address: Record<string, unknown>;
		/** The full derivation path (e.g., "m/44'/283'/0'/0/0") */
		path: string;
		/** Account index */
		account: number;
		/** Context index */
		context: number;
		/** Address index */
		index: number;
		/** Derivation index */
		derivation: number;
		/** ID of the root key used for derivation */
		parentKeyId: string;
	};
}
export function isXHDDerivedKeyData(key: any): key is XHDDerivedKeyData {
	return key?.type === "hd-derived-ed25519";
}

/**
 * Represents metadata for an HD-derived P256 key.
 */
export interface XHDDomainP256KeyData extends KeyData {
	type: "hd-derived-p256";
	algorithm: "P256";
	metadata: {
		/** The origin (RP ID) of the P256 key */
		origin: string;
		/** The user handle associated with the P256 key */
		userHandle: string;
		/** Optional usage counter */
		counter?: number;
		/** ID of the root key used for derivation */
		parentKeyId: string;
		/** Optional identifier for the passphrase used to protect this key */
		passphraseId?: string;
	};
}

export function isXHDDomainP256KeyData(key: any): key is XHDDomainP256KeyData {
	return key?.type === "hd-derived-p256";
}

/**
 * Options for generating a new key.
 */
export interface GenerateOptions {
	/** Key type */
	type: KeyType;
	/** Algorithm */
	algorithm: Algorithm; // TODO: leverage subtle Algorithms?
	/** Whether the key can be extracted from the key store */
	extractable: boolean;
	/** Key usage */
	keyUsages: KeyUsage[];
	/** Key size in bits (e.g., 2048 for RSA) */
	keySize?: number;
	/** Curve for asymmetric keys (e.g., 'P-256') */
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
	/** Derivation mode */
	mode?: "standard" | "peikert" | "slip10";
	/** For P256 domain-specific derivation (WebAuthn/domain-keys) */
	origin?: string;
	/** For P256 domain-specific derivation (WebAuthn/domain-keys) */
	userHandle?: string;
	/** Counter for multiple keys per domain (default: 0) */
	counter?: number;
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
	/** Whether to require a passphrase for sensitive operations */
	requirePassphrase?: boolean;
}
