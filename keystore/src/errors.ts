/**
 * Base error class for keystore operations.
 */
export class KeyStoreError extends Error {
	constructor(message: string, name: string, cause?: Error) {
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
