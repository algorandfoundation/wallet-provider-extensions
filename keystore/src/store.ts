import type {
	Secret,
	SecretStoreState,
} from "@algorandfoundation/secret-store";
import {
	BIP32DerivationType,
	fromSeed,
	KeyContext,
} from "@algorandfoundation/xhd-wallet-api";
import { base64url } from "@scure/base";
import type { Store } from "@tanstack/store";
import { generateId } from "./crypto.ts";
import { InvalidKeyDataError, KeyNotFoundError } from "./errors.ts";
import type {
	ExportOptions,
	Key,
	KeyId,
	KeyStoreContext,
	KeyStoreExtension,
	KeyStoreState,
} from "./types.ts";

/**
 * Imports an existing key into the keystore
 *
 * Supports two key types:
 * - Ed25519: Used for Algorand signatures. Can derive public key from 64-byte private key.
 * - P-256 (secp256r1): Used for WebAuthn/Passkey. Requires explicit public key.
 *
 * Ed25519 keys are 32-byte public keys + 64-byte private keys (includes public key)
 * P-256 keys use 33-byte compressed or 65-byte uncompressed public keys
 */
export function importKey({
	store,
	key,
}: {
	store: Store<KeyStoreState>;
	key: Key;
}): Key {
	// Clone the key object to avoid mutating the original
	const _key = { ...key };

	// Check for a keypair or leverage an existing secret to import public keys
	if (!_key.publicKey && !_key.privateKey) {
		if (!_key.secretId && (!_key.metadata.account || !_key.metadata.keyIndex)) {
			throw new InvalidKeyDataError("No secret or metadata provided");
		} else {
			throw new InvalidKeyDataError("publicKey or privateKey required");
		}
	}

	const isP256 = _key.algorithm === "ES256";
	let publicKey = _key.publicKey;

	// Update metadata
	_key.metadata.curve = isP256 ? "secp256r1" : "Ed25519";

	// TODO: if the Key has a secretId, use it to find the type of secret and handle appropriately (bip39, algo25, etc).
	// TODO: The metadata alone can be used to import more public keys (ie secretId="ABCD", metadata.account = 0)

	// For Ed25519: derive public key from private key if not provided
	// The private key format is 64 bytes: [32 bytes seed || 32 bytes public key]
	if (!publicKey && _key.privateKey) {
		if (isP256) {
			throw new InvalidKeyDataError(
				"P256 import requires both publicKey and privateKey",
			);
		}
		if (_key.privateKey.length !== 64) {
			throw new InvalidKeyDataError(
				"Ed25519 import requires publicKey or 64-byte combined key",
			);
		}
		publicKey = _key.privateKey.slice(32);
	}

	if (!publicKey) {
		throw new InvalidKeyDataError("Could not derive public key");
	}

	// Mutate the Store
	store.setState((state) => {
		return {
			keys: [_key, ...state.keys],
			activeKey: _key,
		};
	});

	return Object.freeze(_key);
}

/**
 * Exports public key data for a given key ID
 * Note: Private keys are never exported for security
 */
export function exportKey({
	store,
	id,
}: {
	store: Store<KeyStoreState>;
	id: KeyId;
	options?: ExportOptions;
}): Key {
	const key = store.state.keys.find((k) => k.id === id);
	if (!key) {
		throw new KeyNotFoundError(id);
	}
	return Object.freeze(key);
}

/**
 * Removes a key or seed from storage
 * Attempts to delete from both key and seed storage
 */
export function removeKey({
	store,
	secrets,
	id,
}: {
	store: Store<KeyStoreState>;
	secrets: Store<SecretStoreState>;
	id: KeyId;
}): void {
	const key = store.state.keys.find((k) => k.id === id);
	// Bailout early if key not found
	if (!key) {
		throw new KeyNotFoundError(id);
	}
	// If the key has a secretId, remove the secret as well
	// TODO: check for all keys before removing, we do not want to remove a seed which may have other derived accounts
	const isLastKey = false;
	if (key.secretId && isLastKey) {
		secrets.setState((state) => {
			return {
				secrets: state.secrets.filter((s) => s.id !== key.secretId),
				activeSecret:
					state.activeSecret && state.activeSecret.id === key.secretId
						? state.secrets[0]
						: state.activeSecret,
			};
		});
	}

	// Mutate the Keys Store
	store.setState((state) => {
		const keys = state.keys.filter((k) => k.id !== id);
		return {
			keys,
			activeKey:
				state.activeKey && state.activeKey.id === id
					? keys[0]
					: state.activeKey,
		};
	});
}

export async function importSeed({
	store,
	provider,
	secret,
	key,
}: {
	store: Store<KeyStoreState>;
	provider: KeyStoreContext & KeyStoreExtension;
	secret: Omit<Secret, "id">;
	key: Key;
}): Promise<KeyId> {
	const _key = { ...key };
	if (secret.type !== "bip39" && secret.type !== "raw")
		throw new InvalidKeyDataError("Seed must be a bip39 mnemonic or raw bytes");
	if (secret.value === null || secret.value === undefined)
		throw new InvalidKeyDataError("Seed must be a non-null value");
	if (provider.secrets.find((s) => s.value === secret.value))
		throw new InvalidKeyDataError("Seed already exists in keystore");

	// TODO: lift this limit and support all known key types.
	if (_key.type !== "xhd-derived")
		throw new InvalidKeyDataError(
			"Seed must be derived from a mnemonic using xhd-derived keys",
		);

	// Extract seed bytes from mnemonic or Base64URL encoded raw bytes
	const seed =
		secret.type === "bip39"
			? await provider.crypto.bip39.mnemonicToSeed(secret.value)
			: base64url.decode(secret.value);

	// Add the seed to the secrets store
	await provider.secret.add({
		id: generateId(),
		...secret,
	});

	if (seed.length !== 32 && seed.length !== 64) {
		throw new InvalidKeyDataError(
			`Invalid seed length: ${seed.length}. Expected 32 or 64 bytes.`,
		);
	}

	// Get the root key
	const rootKey = fromSeed(seed as Buffer);

	// Apply defaults to the container
	_key.id = _key.id ?? generateId();
	_key.metadata.context = _key.metadata.context ?? KeyContext.Address;
	_key.metadata.account = _key.metadata.account ?? 0;
	_key.metadata.keyIndex = _key.metadata.keyIndex ?? 0;
	_key.metadata.keyIndex =
		_key.metadata.keyIndex ?? BIP32DerivationType.Peikert;
	_key.metadata.curve = _key.metadata.curve ?? "ed25519";
	_key.publicKey = await provider.crypto.xhd.keyGen(
		rootKey,
		_key.metadata.context,
		_key.metadata.account,
		_key.metadata.keyIndex,
		_key.metadata.keyIndex,
	);

	store.setState((state) => {
		return {
			keys: [_key, ...state.keys],
			activeKey: _key,
		};
	});

	return _key.id;
}
