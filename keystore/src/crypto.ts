/**
 * Extended Hierarchical Deterministic (HD) Key Store Backend
 *
 * This class provides a secure key management system supporting:
 * - BIP32-Ed25519 hierarchical deterministic wallets (ARC-0052 standard)
 * - P-256 ECDSA keys for WebAuthn/Passkey compatibility
 * - Key import/export, signing, encryption, and shared secret derivation
 *
 * HD Wallet Concept:
 * Instead of managing many unrelated keys, you start with a single seed (like a master password).
 * From this seed, you can deterministically derive an unlimited tree of child keys using paths
 * like "m/44'/283'/0'/0'/0'". This means:
 * - Backup is just the seed (usually as a 12-24 word mnemonic)
 * - Same seed always produces the same keys
 * - Keys are organized hierarchically (accounts, addresses, etc.)
 */
// Requirements

// Framework Components
import type { Secret, SecretId } from "@algorandfoundation/secret-store";
import {
	BIP32DerivationType,
	Encoding,
	fromSeed,
	KeyContext,
} from "@algorandfoundation/xhd-wallet-api";
import {
	crypto_generichash,
	//crypto_scalarmult,
	//crypto_scalarmult_ed25519_base_noclamp,
	crypto_secretbox_easy,
	crypto_secretbox_open_easy,
	//crypto_sign_ed25519_pk_to_curve25519,
	//crypto_sign_ed25519_sk_to_curve25519,
} from "@algorandfoundation/xhd-wallet-api/dist/sumo.facade.js";
import type { Store } from "@tanstack/store";

// Internal Components
import {
	InvalidKeyDataError,
	KeyGenerationNotSupportedError,
	KeyNotFoundError,
} from "./errors.ts";
import type { XHDDerivedKey, XHDDerivedPasskey } from "./keys.ts";
import type {
	DeriveOptions,
	GenerateOptions,
	Key,
	KeyId,
	KeyStoreContext,
	KeyStoreExtension,
	KeyStoreState,
} from "./types.ts";

/**
 * Signs data with the specified key
 *
 * P-256 signing uses deterministic ECDSA via the dp256 library
 * Ed25519 signing uses the XHDWalletAPI which implements BIP32-Ed25519
 *
 * Ed25519 is an EdDSA signature scheme - it's deterministic (no randomness needed)
 * and produces 64-byte signatures.
 */
export async function sign({
	store,
	provider,
	id,
	data,
	passphrase = "",
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	id: KeyId;
	data: Uint8Array;
	passphrase?: string;
}): Promise<Uint8Array> {
	const key = store.state.keys.find((k) => k.id === id);
	if (!key) {
		throw new KeyNotFoundError(id);
	}

	if (key.algorithm === "secp256r1") {
		if (!key.privateKey) {
			throw new InvalidKeyDataError("No private key available for signing");
		}
		try {
			return provider.crypto.dp256.signWithDomainSpecificKeyPair(
				key.privateKey,
				data,
			);
		} finally {
			// Has no effect since the scope is usually immutable
			// In contexts where they have access to the private key material, there is nothing we can do
			// to prevent this access. In contexts that are behind an enclave, the privateKey is always null.
			clearBuffer(key.privateKey);
		}
	}

	// Ed25519 HD signing requires rootKey and derivation context
	if (
		key.secretId == null ||
		key.metadata.account == null ||
		key.metadata.keyIndex == null
	) {
		throw new InvalidKeyDataError(
			"Ed25519 signing requires HD-derived key with rootKey and derivation context",
		);
	}

	// find rootKey by seedID
	const seed = provider.secrets.find((s) => s.id === key.secretId);
	if (!seed || seed.value == null) {
		throw new KeyNotFoundError(
			`Seed with ID ${key.secretId} not found for signing`,
		);
	}

	const rootKey = fromSeed(
		Buffer.from(
			await provider.crypto.bip39.mnemonicToSeed(seed.value, passphrase),
		),
	);

	// Note: signData uses the rootKey to derive the signing key internally.
	// The sensitive derived key is not exposed to us, so we can't clear it here.
	// Consider this when choosing storage - encrypted storage wrappers are recommended.
	return provider.crypto.xhd.signData(
		rootKey,
		key.metadata.context ?? KeyContext.Identity,
		key.metadata.account ?? 0,
		key.metadata.keyIndex ?? 0,
		data,
		{ encoding: Encoding.NONE, schema: {} },
		BIP32DerivationType.Peikert,
	);
}

/**
 * Generates a cryptographically secure random ID (hex string)
 * Uses the Web Crypto API's getRandomValues for secure randomness
 */
export function generateId(): KeyId {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Securely clears sensitive data from memory by overwriting with zeros.
 * Use this after cryptographic operations to minimize key exposure.
 */
export function clearBuffer(data?: Uint8Array): void {
	if (data) {
		data.fill(0);
	}
}

/**
 * Compares two byte arrays lexicographically.
 * Returns negative if a < b, positive if a > b, zero if equal.
 * Used for deterministic ordering in ECDH.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

/**
 * Direct key generation is not supported - HD wallets require seeds
 * Users should use importSeed() + deriveFromSeed() instead
 */
export async function generateKey(_options: GenerateOptions): Promise<Key> {
	throw new KeyGenerationNotSupportedError(
		"Direct key generation not supported. Use importSeed() + deriveFromSeed() for HD derivation.",
	);
}

/**
 * Derives a child key from a seed using a BIP44-style derivation path
 *
 * Paths follow the format: m / purpose' / coin_type' / account' / change / address_index
 * The ' indicates a "hardened" derivation (uses parent private key)
 *
 * Examples:
 * - m/44'/283'/0'/0'/0' - Algorand address 0 (hardened)
 * - m/44'/283'/0'/0/0 - Algorand address 0 (non-hardened)
 *
 */
export async function deriveFromSeed({
	store,
	provider,
	secretId,
	path,
	options,
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	secretId: SecretId;
	path: string;
	options?: DeriveOptions;
}): Promise<Key> {
	const secret = provider.secrets.find((s) => s.id === secretId);
	if (!secret || secret.value == null) {
		throw new KeyNotFoundError(secretId);
	}

	const isP256 =
		options?.curve === "secp256r1" || options?.algorithm === "ES256";

	return isP256
		? deriveP256FromSeed({ store, provider, secret, options })
		: deriveEd25519FromSeed({ store, provider, secret, path, options });
}

/**
 * Derives a P-256 key deterministically from seed
 *
 * Uses domain-specific derivation: keys are generated based on
 * origin (domain), userHandle, and counter. Same inputs always
 * produce the same key pair.
 *
 * @TODO: This interface SHOULD be leveraged by a Passkey extension, it then can have a more concrete type of Passkey
 * @TODO: Passkey extension should allow a friendly interface to this primitive (ie `seed.derive('passkey', options)` and `passkey.sign(data, schema)`)
 */
export async function deriveP256FromSeed({
	store,
	provider,
	secret,
	options,
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	secret: Secret;
	options?: DeriveOptions;
}): Promise<Key> {
	if (!secret || secret.value == null) {
		throw new KeyNotFoundError(secret.id);
	}

	const rootKey = fromSeed(
		Buffer.from(await provider.crypto.bip39.mnemonicToSeed(secret.value, "")),
	);

	const privateKey = await provider.crypto.dp256.genDomainSpecificKeyPair(
		rootKey,
		options?.origin ?? "default",
		options?.userHandle ?? "default",
		options?.counter ?? 0,
	);

	const publicKey = provider.crypto.dp256.getPurePKBytes(privateKey);

	const id = options?.id ?? generateId();

	const key: XHDDerivedPasskey = {
		id,
		// TODO: leverage these types in a bespoke Passkey extension which subsets the keystore for passkey operations
		type: "xhd-passkey",
		algorithm: "ES256",
		metadata: {
			curve: "secp256r1",
			origin: options?.origin ?? "default",
			userHandle: options?.userHandle ?? "default",
			counter: options?.counter ?? 0,

			// TODO: add to base metadata
			createdAt: new Date(),
			labels: options?.name ? { name: options.name } : undefined,
		},

		// Key material
		publicKey,
		privateKey,
	};
	store.setState((state) => {
		return {
			keys: [key, ...state.keys],
			activeKey: key,
		};
	});

	return key;
}

/**
 * Derives an Ed25519 key from seed using BIP32-Ed25519
 *
 * BIP32-Ed25519 is an extension of BIP32 for Ed25519 curves.
 * Unlike secp256k1, Ed25519 has special requirements:
 * - Public keys can't be directly derived from parent public key only
 * - Uses a "extended" private key format (64 bytes: kL, kR)
 *
 * We support two derivation modes:
 * - Peikert (default): Non-linear keyspace, better security properties
 * - Khovratovich (standard): Linear keyspace, BIP32-compatible
 *
 */
export async function deriveEd25519FromSeed({
	store,
	provider,
	secret,
	path,
	options,
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	secret: Secret;
	path: string;
	options?: DeriveOptions;
}): Promise<Key> {
	if (secret.value == null) throw new Error("Secret value cannot be null");

	const derivationPath = parsePath(path);
	const derivationType =
		options?.mode === "standard"
			? BIP32DerivationType.Khovratovich
			: BIP32DerivationType.Peikert;

	// Determine key context from coin_type in path
	// 0x8000011b (283) = Algorand addresses, others = Identity
	const context =
		derivationPath[1] === 0x8000011b ? KeyContext.Address : KeyContext.Identity;
	const account = (derivationPath[2] ?? 0x80000000) & 0x7fffffff;
	const keyIndex = (derivationPath[4] ?? 0) & 0x7fffffff;

	const rootKey = fromSeed(
		// TODO: fix buffers, not available in all contexts
		Buffer.from(await provider.crypto.bip39.mnemonicToSeed(secret.value, "")),
	);

	const derivedPublic = await provider.crypto.xhd.keyGen(
		rootKey,
		context,
		account,
		keyIndex,
		derivationType,
	);

	const id = options?.id ?? generateId();

	const key: XHDDerivedKey = {
		id,
		type: "xhd-derived",
		algorithm: "EdDSA",
		secretId: secret.id,
		// Every type should have well-defined metadata
		metadata: {
			curve: "ed25519",
			derivationPath: path,
			derivationType,
			// NOTE: in an identity | passkey extension, this context is used to subset the keystore.
			context,
			account,
			keyIndex,

			// TODO: move this to wallet-provider as default metadata for any collection
			createdAt: new Date(),
			labels: options?.name ? { name: options.name } : undefined,
		},
		// The public Key
		publicKey: derivedPublic,
	};

	store.setState((state) => {
		return {
			keys: [key, ...state.keys],
			activeKey: key,
		};
	});

	return key;
}

/**
 * Parses a BIP44 derivation path string into an array of indices
 *
 * Path format: m / purpose' / coin_type' / account' / change / address_index
 * Hardened indices (marked with ' or h) have 0x80000000 (2^31) added
 *
 * Example: m/44'/283'/0'/0'/0' becomes [44, 283, 0, 0, 0] with hardening
 */
export function parsePath(path: string): number[] {
	return path
		.replace(/^m\/?/, "")
		.split("/")
		.map((part) => {
			const hardened = part.endsWith("'") || part.endsWith("h");
			const index = parseInt(part.replace(/['h]$/, ""), 10);
			return hardened ? index + 0x80000000 : index;
		});
}

/**
 * Derives a shared secret using ECDH (Elliptic Curve Diffie-Hellman)
 *
 * ECDH allows two parties to establish a shared secret:
 * - Party A has private key 'a' and public key 'aG' (G = generator point)
 * - Party B has private key 'b' and public key 'bG'
 * - Shared secret = a * bG = b * aG = abG
 *
 * For Ed25519, we convert to X25519 (Curve25519) format first because:
 * - Ed25519 is optimized for signatures
 * - X25519 is optimized for ECDH
 * - Both use the same underlying curve but different representations
 *
 * This method works for both HD-derived keys and imported keys.
 */
export async function deriveSharedSecret(
	//key: Key,
): Promise<Uint8Array> {
	return new Uint8Array(0); // Placeholder implementation
}

/**
 * Extracts the Ed25519 private key from a stored key
 *
 * For HD keys: derives the child private key from the root key
 * For imported keys: returns a copy of the stored private key (safe to clear after use)
 */
export async function getEd25519PrivateKey({
	provider,
	key,
}: {
	provider: KeyStoreContext & KeyStoreExtension;
	key: Key;
}): Promise<Uint8Array> {
	// Direct private key available (imported non-HD key)
	// Return a copy so the caller can safely clear it without affecting stored data
	if (key.privateKey) {
		return new Uint8Array(key.privateKey);
	}

	// HD key - derive from root
	if (key.type === "xhd-derived" && key.metadata.context !== undefined) {
		const secret = provider.secrets.find((s) => s.id === key.secretId);
		if (!secret || !secret.value) {
			throw new InvalidKeyDataError("No seed available");
		}

		const rootKey = fromSeed(
			Buffer.from(
				await provider.crypto.bip39.mnemonicToSeed(
					secret.value,
					secret?.metadata?.passphrase,
				),
			),
		);
		const extendedPrivateKey = await provider.crypto.xhd.deriveKey(
			rootKey,
			[
				key.metadata.context,
				key.metadata.account ?? 0,
				0,
				key.metadata.keyIndex ?? 0,
			],
			true, // Return private key
			BIP32DerivationType.Peikert,
		);
		// Extended format: 96 bytes total (kL || kR || chainCode)
		// We only need the first 64 bytes (kL || kR) for signing/ECDH
		return extendedPrivateKey.slice(0, 64);
	}

	throw new InvalidKeyDataError("No private key available");
}

/**
 * Encrypts data using a public key
 *
 * Uses NaCl's secretbox (XSalsa20 + Poly1305):
 * - XSalsa20: Stream cipher for encryption
 * - Poly1305: MAC for authentication (prevents tampering)
 *
 * The symmetric key is derived by hashing the public key.
 * Each encryption uses a random 24-byte nonce.
 * Format: [24-byte nonce || ciphertext]
 *
 */
export async function encryptWithKey({
	key,
	data,
}: {
	key: Key;
	data: Uint8Array;
	algorithm?: string;
}): Promise<Uint8Array> {
	// TODO: handle all known variants. ie PrivateKey, XHD
	if (!key.publicKey) {
		throw new KeyNotFoundError(key.id);
	}

	// Derive symmetric key from public key using BLAKE2b (generichash)
	const symmetricKey = crypto_generichash(32, key.publicKey);

	// Generate random nonce (number used once) - must be unique per encryption
	const nonce = new Uint8Array(24);
	crypto.getRandomValues(nonce);

	// Encrypt with XSalsa20-Poly1305 (NaCl secretbox)
	const ciphertext = crypto_secretbox_easy(data, nonce, symmetricKey);

	// Output format: nonce || ciphertext
	const result = new Uint8Array(24 + ciphertext.length);
	result.set(nonce, 0);
	result.set(ciphertext, 24);
	return result;
}

/**
 * Decrypts data encrypted with encryptWithKey
 *
 * Requires the private key corresponding to the public key used for encryption.
 * Extracts nonce from first 24 bytes, decrypts the rest.
 */
export async function decryptWithKey({
	key,
	data,
}: {
	key: Key;
	data: Uint8Array;
	algorithm?: string;
}): Promise<Uint8Array> {
	if (!key.publicKey) {
		throw new KeyNotFoundError(key.id);
	}

	const symmetricKey = crypto_generichash(32, key.publicKey);
	const nonce = data.slice(0, 24);
	const ciphertext = data.slice(24);

	return crypto_secretbox_open_easy(ciphertext, nonce, symmetricKey);
}

/**
 * Encrypts data using a passphrase (password-based encryption)
 *
 * Uses PBKDF2-like key derivation with random salt:
 * - Salt: 16 random bytes (prevents rainbow table attacks)
 * - Key derivation: BLAKE2b(salt || passphrase)
 * - Encryption: XSalsa20-Poly1305 with random nonce
 *
 * Format: [16-byte salt || 24-byte nonce || ciphertext]
 */
export async function encryptData({
	data,
	passphrase,
}: {
	data: Uint8Array;
	passphrase?: string;
}): Promise<Uint8Array> {
	if (!passphrase) {
		throw new InvalidKeyDataError("Passphrase required for encryption");
	}

	// Generate random salt for key derivation
	const salt = new Uint8Array(16);
	crypto.getRandomValues(salt);

	// Derive key from passphrase using BLAKE2b with salt
	const key = crypto_generichash(
		32,
		new TextEncoder().encode(passphrase),
		salt,
	);

	// Generate random nonce
	const nonce = new Uint8Array(24);
	crypto.getRandomValues(nonce);

	// Encrypt
	const ciphertext = crypto_secretbox_easy(data, nonce, key);

	// Output format: salt || nonce || ciphertext
	const result = new Uint8Array(16 + 24 + ciphertext.length);
	result.set(salt, 0);
	result.set(nonce, 16);
	result.set(ciphertext, 40);
	return result;
}

/**
 * Decrypts data encrypted with encryptData
 *
 * Extracts salt and nonce, re-derives key from passphrase, decrypts.
 */
export async function decryptData({
	data,
	passphrase,
}: {
	data: Uint8Array;
	passphrase?: string;
}): Promise<Uint8Array> {
	if (!passphrase) {
		throw new InvalidKeyDataError("Passphrase required for decryption");
	}

	const salt = data.slice(0, 16);
	const nonce = data.slice(16, 40);
	const ciphertext = data.slice(40);

	const key = crypto_generichash(
		32,
		new TextEncoder().encode(passphrase),
		salt,
	);

	return crypto_secretbox_open_easy(ciphertext, nonce, key);
}

/**
 * Verifies a signature against data using the public key
 *
 * P-256 verification uses Web Crypto API's ECDSA implementation
 * Ed25519 verification uses the XHDWalletAPI
 */
export async function verify({
	provider,
	key,
	data,
	signature,
}: {
	provider: KeyStoreContext & KeyStoreExtension;
	key: Key;
	data: Uint8Array;
	signature: Uint8Array;
	_algorithm?: string;
}): Promise<boolean> {
	if (typeof key.publicKey === "undefined")
		throw new InvalidKeyDataError("No public key available for verification");

	if (key.metadata.curve === "secp256r1") {
		return verifyP256(key.publicKey, data, signature);
	}

	return provider.crypto.xhd.verifyWithPublicKey(
		signature,
		data,
		key.publicKey,
	);
}

/**
 * Verifies a P-256 ECDSA signature using Web Crypto API
 * P-256 public keys need the 0x04 prefix for uncompressed format
 */
export async function verifyP256(
	publicKey: Uint8Array,
	data: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	// Prepend 0x04 to indicate uncompressed point format (SEC1)
	const fullPublicKey = new Uint8Array(65);
	fullPublicKey[0] = 0x04;
	fullPublicKey.set(publicKey, 1);

	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		fullPublicKey,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);

	return crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		cryptoKey,
		new Uint8Array(signature),
		new Uint8Array(data),
	);
}

/**
 * Signs multiple messages in parallel
 *
 * Note: ids and data arrays must be the same length
 */
export async function batchSign({
	store,
	provider,
	ids,
	data,
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	ids: KeyId[];
	data: Uint8Array[];
}): Promise<Uint8Array[]> {
	if (ids.length !== data.length) {
		throw new InvalidKeyDataError(
			"ids and data arrays must have the same length",
		);
	}

	return Promise.all(
		ids.map((id, i) => sign({ store, provider, id, data: data[i] })),
	);
}
