/**
 * The symmetric JSON-RPC-style layer that runs over any
 * {@link ConnectionTransport}.
 *
 * Both peers of a connection build the same {@link ConnectionRpc} over
 * their end of the transport: the dapp side calls `request(...)`, the
 * wallet side registers an `onRequest(...)` handler (typically via
 * `createWalletResponder`), and either side may do both. Envelopes are
 * the versioned {@link ConnectionRequestEnvelope} /
 * {@link ConnectionResponseEnvelope} shapes serialized as JSON strings.
 */

import { ConnectionRpcError } from "./errors.ts";
import type {
  ConnectionMethodParams,
  ConnectionMethodResult,
  ConnectionRequestEnvelope,
  ConnectionResponseEnvelope,
  ConnectionTransport,
} from "./types.ts";

/**
 * Default time a request waits for its response before rejecting.
 *
 * @example
 * ```typescript
 * const rpc = createConnectionRpc(transport, { timeoutMs: DEFAULT_RPC_TIMEOUT_MS / 2 });
 * ```
 */
export const DEFAULT_RPC_TIMEOUT_MS: number = 60_000;

/**
 * Per-request options for {@link ConnectionRpc.request}.
 *
 * @example
 * ```typescript
 * await rpc.request("sign_transactions", { txns }, { timeoutMs: 120_000 });
 * ```
 */
export interface ConnectionRpcRequestOptions {
  /** Overrides the rpc-level timeout for this request. */
  timeoutMs?: number;
  /** Aborts the request; the returned promise rejects with code `aborted`. */
  signal?: AbortSignal;
}

/**
 * A handler answering incoming requests. Throw a {@link ConnectionRpcError}
 * to control the error `code` sent back to the peer; any other thrown
 * value is serialized with code `handler_error`.
 *
 * @example
 * ```typescript
 * const handler: ConnectionRpcHandler = async (method, params) => {
 *   if (method === "connect") return { domains: {} };
 *   throw new ConnectionRpcError("method_not_found", `unknown method ${method}`);
 * };
 * ```
 */
export type ConnectionRpcHandler = (method: string, params: unknown) => Promise<unknown>;

/**
 * The request/response surface both peers use over a shared transport.
 *
 * @example
 * ```typescript
 * const rpc = createConnectionRpc(transport);
 * const result = await rpc.request("connect", { metadata: { name: "My Dapp" } });
 * ```
 */
export interface ConnectionRpc {
  /**
   * Sends a request and resolves with the peer's result.
   *
   * Rejects with a {@link ConnectionRpcError}: the peer's error code when
   * the peer answered with an error envelope, `timeout` when no response
   * arrived in time, `aborted` when the signal fired, and
   * `transport_closed` when the transport closed while pending.
   */
  request<M extends string>(
    method: M,
    params: ConnectionMethodParams<M>,
    opts?: ConnectionRpcRequestOptions,
  ): Promise<ConnectionMethodResult<M>>;
  /**
   * Registers the handler answering incoming requests. Only one handler
   * is active at a time; registering replaces the previous one.
   *
   * @returns An unregister function.
   */
  onRequest(handler: ConnectionRpcHandler): () => void;
  /**
   * Tears down the rpc: unsubscribes from the transport, closes it, and
   * rejects every pending request with code `transport_closed`.
   */
  close(): void;
}

/**
 * Options accepted by {@link createConnectionRpc}.
 *
 * @example
 * ```typescript
 * const rpc = createConnectionRpc(transport, { timeoutMs: 30_000 });
 * ```
 */
export interface CreateConnectionRpcOptions {
  /** Default request timeout; {@link DEFAULT_RPC_TIMEOUT_MS} when omitted. */
  timeoutMs?: number;
}

/**
 * Generates a correlation id: `crypto.randomUUID` where available, with
 * a `Math.random` fallback for older runtimes.
 */
function generateRequestId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRequestEnvelope(value: unknown): value is ConnectionRequestEnvelope {
  const envelope = value as ConnectionRequestEnvelope | null;
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    envelope.v === 1 &&
    envelope.kind === "request" &&
    typeof envelope.id === "string" &&
    typeof envelope.method === "string"
  );
}

function isResponseEnvelope(value: unknown): value is ConnectionResponseEnvelope {
  const envelope = value as ConnectionResponseEnvelope | null;
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    envelope.v === 1 &&
    envelope.kind === "response" &&
    typeof envelope.id === "string"
  );
}

/**
 * Builds a {@link ConnectionRpc} over one end of a transport.
 *
 * Correlates responses to requests by id, applies timeouts and abort
 * signals, and rejects everything pending with `transport_closed` once
 * the transport reaches the `closed` state. Malformed JSON frames and
 * responses to unknown ids are ignored so a misbehaving peer cannot
 * wedge the channel.
 *
 * @param transport - One end of a {@link ConnectionTransport} pair.
 * @param options - {@link CreateConnectionRpcOptions}.
 * @returns The {@link ConnectionRpc} for this peer.
 *
 * @example
 * ```typescript
 * const rpc = createConnectionRpc(transport);
 * const { domains } = await rpc.request("connect", {
 *   metadata: { name: "My Dapp", url: "https://dapp.example" },
 * });
 * ```
 */
export function createConnectionRpc(
  transport: ConnectionTransport,
  options: CreateConnectionRpcOptions = {},
): ConnectionRpc {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const pending = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: ConnectionRpcError) => void }
  >();
  let handler: ConnectionRpcHandler | undefined;
  let closed = false;

  const rejectAllPending = (error: ConnectionRpcError): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  const respond = (envelope: ConnectionResponseEnvelope): void => {
    if (transport.state !== "open") return;
    transport.send(JSON.stringify(envelope));
  };

  const handleRequest = async (envelope: ConnectionRequestEnvelope): Promise<void> => {
    const currentHandler = handler;
    if (!currentHandler) {
      respond({
        v: 1,
        kind: "response",
        id: envelope.id,
        error: { code: "method_not_found", message: `no handler for method ${envelope.method}` },
      });
      return;
    }
    try {
      const result = await currentHandler(envelope.method, envelope.params);
      respond({ v: 1, kind: "response", id: envelope.id, result });
    } catch (e) {
      const code = e instanceof ConnectionRpcError ? e.code : "handler_error";
      const message = e instanceof Error ? e.message : String(e);
      respond({ v: 1, kind: "response", id: envelope.id, error: { code, message } });
    }
  };

  const unsubscribeMessage = transport.onMessage((data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Malformed JSON frames are ignored.
    }
    if (isResponseEnvelope(parsed)) {
      const entry = pending.get(parsed.id);
      if (!entry) return; // Responses to unknown ids are ignored.
      pending.delete(parsed.id);
      if (parsed.error) {
        entry.reject(new ConnectionRpcError(parsed.error.code, parsed.error.message));
      } else {
        entry.resolve(parsed.result);
      }
      return;
    }
    if (isRequestEnvelope(parsed)) {
      void handleRequest(parsed);
    }
  });

  const unsubscribeState = transport.onStateChange((state) => {
    if (state === "closed") {
      rejectAllPending(new ConnectionRpcError("transport_closed", "transport closed"));
    }
  });

  return {
    request<M extends string>(
      method: M,
      params: ConnectionMethodParams<M>,
      opts: ConnectionRpcRequestOptions = {},
    ): Promise<ConnectionMethodResult<M>> {
      return new Promise<ConnectionMethodResult<M>>((resolve, reject) => {
        if (closed || transport.state === "closed") {
          reject(new ConnectionRpcError("transport_closed", "transport closed"));
          return;
        }
        if (opts.signal?.aborted) {
          reject(new ConnectionRpcError("aborted", "request aborted"));
          return;
        }

        const id = generateRequestId();
        const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;

        const cleanup = (): void => {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
        };

        const timer = setTimeout(() => {
          pending.delete(id);
          cleanup();
          reject(new ConnectionRpcError("timeout", `request ${method} timed out`));
        }, timeoutMs);

        const onAbort = (): void => {
          pending.delete(id);
          cleanup();
          reject(new ConnectionRpcError("aborted", "request aborted"));
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });

        pending.set(id, {
          resolve: (result: unknown) => {
            cleanup();
            resolve(result as ConnectionMethodResult<M>);
          },
          reject: (error: ConnectionRpcError) => {
            cleanup();
            reject(error);
          },
        });

        const envelope: ConnectionRequestEnvelope = { v: 1, kind: "request", id, method, params };
        try {
          transport.send(JSON.stringify(envelope));
        } catch (e) {
          pending.delete(id);
          cleanup();
          reject(
            new ConnectionRpcError("transport_closed", `failed to send request: ${String(e)}`),
          );
        }
      });
    },
    onRequest(next: ConnectionRpcHandler): () => void {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      unsubscribeMessage();
      unsubscribeState();
      rejectAllPending(new ConnectionRpcError("transport_closed", "rpc closed"));
      transport.close();
    },
  };
}
