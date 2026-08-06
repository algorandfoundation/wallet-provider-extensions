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
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KeyStoreError);
    }
  }
}

/**
 * Error thrown when a requested key cannot be found in the keystore.
 */
export class KeyNotFoundError extends KeyStoreError {
  /**
   * @param keyId - The ID of the key that was not found.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(keyId: string, cause?: Error) {
    super(`Key not found: ${keyId}`, "KeyNotFoundError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KeyNotFoundError);
    }
  }
}

/**
 * Error thrown when an attempt is made to generate a key with an unsupported algorithm.
 */
export class KeyGenerationNotSupportedError extends KeyStoreError {
  /**
   * @param algorithm - The name of the unsupported algorithm.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(algorithm: string, cause?: Error) {
    super(
      `Key generation not supported for algorithm: ${algorithm}`,
      "KeyGenerationNotSupportedError",
      cause,
    );
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KeyGenerationNotSupportedError);
    }
  }
}

/**
 * Error thrown when key data is provided in an invalid or unsupported format.
 */
export class InvalidKeyFormatError extends KeyStoreError {
  /**
   * @param format - The name of the invalid format.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(format: string, cause?: Error) {
    super(`Invalid key format: ${format}`, "InvalidKeyFormatError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidKeyFormatError);
    }
  }
}

/**
 * Error thrown when an attempt is made to import or generate a key with an ID that already exists.
 */
export class DuplicateKeyIdError extends KeyStoreError {
  /**
   * @param keyId - The duplicate key ID.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(keyId: string, cause?: Error) {
    super(`Duplicate key ID: ${keyId}`, "DuplicateKeyIdError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuplicateKeyIdError);
    }
  }
}

/**
 * Error thrown when raw key material is requested from, or supplied to, the
 * public Subtle surface directly.
 *
 * The composable shims never own key material: `sign`/`deriveBits` receive it
 * just-in-time through their algorithm parameters, and `importKey`/`exportKey`
 * are delegated to a platform storage engine that owns encrypted-at-rest
 * material. Any attempt to move material across the public `SubtleCrypto`
 * surface therefore throws this error.
 */
export class MaterialAccessError extends KeyStoreError {
  /**
   * @param reason - A description of why material access was refused.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(reason: string, cause?: Error) {
    super(`Material access denied: ${reason}`, "MaterialAccessError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MaterialAccessError);
    }
  }
}

/**
 * Error thrown when provided key data is malformed or invalid for the operation.
 */
export class InvalidKeyDataError extends KeyStoreError {
  /**
   * @param reason - A description of why the key data is invalid.
   * @param cause - The underlying error that caused this error, if any.
   */
  constructor(reason: string, cause?: Error) {
    super(`Invalid key data: ${reason}`, "InvalidKeyDataError", cause);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidKeyDataError);
    }
  }
}
