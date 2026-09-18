/**
 * Error raised by the connections RPC layer, carrying a stable machine
 * code alongside the human-readable message.
 *
 * Well-known codes:
 * - `rejected`: the user or an approval hook denied the request.
 * - `timeout`: no response arrived before the request deadline.
 * - `aborted`: the caller aborted the request via an `AbortSignal`.
 * - `transport_closed`: the underlying transport closed with the request pending.
 * - `handler_error`: the remote handler threw a non-{@link ConnectionRpcError}.
 * - `method_not_found`: the remote peer does not implement the method.
 * - `invalid_params`: the request params were malformed (e.g. a `message` without ciphertext).
 * - `decrypt_failed`: a `message` payload did not open under the session's shared key.
 * - `unknown_message`: a `message_ack` referenced a message id this side does not hold.
 * - `secure_channel_unavailable`: a `message` arrived before a secure channel was
 *   derived for the session (e.g. the peer introduced no usable `keyAgreement` key).
 *
 * When a wallet-side handler throws a `ConnectionRpcError`, its `code`
 * travels verbatim inside the response envelope's `error.code`, so the
 * requesting side can rethrow it losslessly.
 *
 * @example
 * ```typescript
 * throw new ConnectionRpcError("rejected", "user denied the connection");
 * ```
 */
export class ConnectionRpcError extends Error {
  /** Stable machine-readable error code (e.g. `rejected`, `timeout`). */
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ConnectionRpcError";
    this.code = code;
  }
}
