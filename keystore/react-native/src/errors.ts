/**
 * Decoding failed.
 */
export class DecodingError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "DecodingError";
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DecodingError);
    }
  }
}

export class EncodingError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "EncodingError";
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EncodingError);
    }
  }
}

export class UnlockingError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "UnlockingError";
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnlockingError);
    }
  }
}

export class MasterKeyNotFoundError extends Error {
  constructor(message = "Master key not found", cause?: Error) {
    super(message);
    this.name = "MasterKeyNotFoundError";
    if (cause) {
      this.cause = cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MasterKeyNotFoundError);
    }
  }
}
