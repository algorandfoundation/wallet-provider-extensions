/**
 * @module protocol
 *
 * The keystore's JSON-RPC 2.0 wire protocol — the single description of what a
 * keystore looks like once it is no longer in the caller's process.
 *
 * Nothing here knows about a socket, a WebSocket or a runtime: a *frame* is a
 * string, and how frames travel is the concern of a
 * {@link import("./types.ts").RemoteTransport}. Both ends of a session —
 * the {@link import("./client.ts").createRemoteKeyStore client engine} and the
 * {@link import("./server.ts").createKeyStoreResponder responder} — depend on
 * this module so they stay in lockstep.
 *
 * Because JSON has no byte type, `Uint8Array` values (signatures, public keys,
 * seed bytes, …) are carried as a small {@link BytesEnvelope}
 * (`{ "$bytes": base64 }`) and transparently re-materialized by
 * {@link decodeValue}.
 */

/** The JSON-RPC protocol version string every envelope carries. */
export const JSON_RPC_VERSION = "2.0";

/**
 * The method name of the responder → client state notification. On connect (and
 * on every subsequent change) the responder pushes the current
 * {@link import("@algorandfoundation/keystore-core").KeyStoreState} so a client
 * engine can keep its reactive store hydrated without polling.
 */
export const RPC_STATE_METHOD = "state";

/** JSON-RPC 2.0 request envelope (client → responder). */
export interface RpcRequest {
  /** Always {@link JSON_RPC_VERSION}. */
  jsonrpc: string;
  /** Correlation id echoed back on the matching {@link RpcResponse}. */
  id: number;
  /** The invoked method name (see {@link RPC_METHODS}). */
  method: string;
  /** Positional, {@link encodeValue}-encoded arguments. */
  params: unknown[];
}

/** JSON-RPC 2.0 response envelope (responder → client). */
export interface RpcResponse {
  /** Always {@link JSON_RPC_VERSION}. */
  jsonrpc: string;
  /** The id of the {@link RpcRequest} this answers. */
  id: number;
  /** The {@link encodeValue}-encoded result, when the call succeeded. */
  result?: unknown;
  /** The failure detail, when the call threw. */
  error?: RpcError;
}

/** JSON-RPC 2.0 notification envelope (an id-less message, e.g. state push). */
export interface RpcNotification {
  /** Always {@link JSON_RPC_VERSION}. */
  jsonrpc: string;
  /** The notification name (e.g. {@link RPC_STATE_METHOD}). */
  method: string;
  /** Positional, {@link encodeValue}-encoded arguments. */
  params: unknown[];
}

/** The failure payload carried by a {@link RpcResponse}. */
export interface RpcError {
  /** A {@link RpcErrorCode} value. */
  code: number;
  /** A human-readable message (mirrors the thrown `Error.message`). */
  message: string;
  /** Optional structured detail. */
  data?: unknown;
}

/** Any framed message that can cross the wire. */
export type RpcMessage = RpcRequest | RpcResponse | RpcNotification;

/**
 * The JSON-RPC error codes used by the keystore protocol. The negative range
 * mirrors the JSON-RPC 2.0 spec; {@link RpcErrorCode.operationFailed} is the
 * server-defined code used when a keystore operation itself throws.
 */
export const RpcErrorCode = {
  /** Malformed JSON was received. */
  parseError: -32700,
  /** The method is not part of {@link RPC_METHODS}. */
  methodNotFound: -32601,
  /** The arguments were invalid. */
  invalidParams: -32602,
  /** An unexpected server error occurred. */
  internalError: -32603,
  /** A keystore operation threw (e.g. key not found); see the message. */
  operationFailed: -32000,
} as const;

/**
 * Every method a client may invoke over the wire. This is the full
 * {@link import("@algorandfoundation/keystore-core").KeyStoreAPI} surface
 * (including the `secrets.*` namespace) plus a `state` pull, and it doubles as
 * the responder's allow-list so nothing outside it is ever dispatched.
 */
export const RPC_METHODS = [
  "generate",
  "import",
  "export",
  "remove",
  "clear",
  "sign",
  "verify",
  "encryptWithKey",
  "decryptWithKey",
  "deriveSharedSecret",
  "importSeed",
  "deriveFromSeed",
  "deriveDomainKey",
  "encryptData",
  "decryptData",
  "logAuditEvent",
  "getAuditLogs",
  "batchSign",
  "secrets.put",
  "secrets.get",
  "secrets.list",
  "secrets.remove",
  "state",
] as const;

/** A method name accepted by the protocol. */
export type RpcMethod = (typeof RPC_METHODS)[number];

/**
 * Narrows an arbitrary string to a supported {@link RpcMethod}.
 *
 * @param method - The method name received on the wire.
 * @returns Whether the responder may dispatch it.
 */
export function isRpcMethod(method: string): method is RpcMethod {
  return (RPC_METHODS as readonly string[]).includes(method);
}

/** The on-the-wire envelope for a `Uint8Array` payload. */
interface BytesEnvelope {
  /** The base64-encoded bytes. */
  $bytes: string;
}

/** Type guard for a {@link BytesEnvelope}. */
function isBytesEnvelope(value: object): value is BytesEnvelope {
  return typeof (value as { $bytes?: unknown }).$bytes === "string";
}

/** Chunk size used when folding bytes into a binary string, to bound the stack. */
const BASE64_CHUNK = 0x8000;

/**
 * Base64-encodes bytes using only the universal `btoa`, so the protocol stays
 * free of `Buffer` and runs unchanged in a browser.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Inverse of {@link toBase64}. */
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Recursively encodes a value for the wire, replacing every `Uint8Array` with a
 * base64 {@link BytesEnvelope}. Plain objects and arrays are walked; primitives
 * (and `Date`, which JSON serializes to an ISO string) pass through unchanged.
 *
 * @param value - The value to encode.
 * @returns A JSON-safe representation.
 *
 * @example
 * ```typescript
 * encodeValue({ signature: new Uint8Array([1, 2]) });
 * // => { signature: { $bytes: "AQI=" } }
 * ```
 */
export function encodeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { $bytes: toBase64(value) } satisfies BytesEnvelope;
  }
  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = encodeValue(item);
    }
    return out;
  }
  return value;
}

/**
 * Inverse of {@link encodeValue}: re-materializes `Uint8Array`s from their
 * base64 {@link BytesEnvelope}s and walks plain objects/arrays.
 *
 * @param value - The wire value to decode.
 * @returns The decoded value, with byte envelopes restored to `Uint8Array`.
 */
export function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }
  if (value !== null && typeof value === "object") {
    if (isBytesEnvelope(value)) {
      return fromBase64(value.$bytes);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = decodeValue(item);
    }
    return out;
  }
  return value;
}

/**
 * Serializes a message into a single frame.
 *
 * The frame is newline-terminated so that stream transports (a Unix socket, a
 * pipe) can use it as NDJSON directly; message transports (WebSocket) send it
 * as one text message and the trailing newline is ignored on receipt.
 *
 * @param message - The envelope to serialize.
 * @returns The frame to hand the transport.
 */
export function encodeFrame(message: RpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Parses one received frame.
 *
 * @param frame - A single frame, with or without its trailing newline.
 * @returns The parsed message, or `undefined` for an empty frame.
 * @throws {SyntaxError} If the frame is not valid JSON.
 */
export function decodeFrame(frame: string): RpcMessage | undefined {
  const line = frame.trim();
  if (line.length === 0) return undefined;
  return JSON.parse(line) as RpcMessage;
}

/** A stateful decoder that turns a stream of chunks into whole messages. */
export interface FrameDecoder {
  /**
   * Feeds a chunk and returns every message it completed. Partial trailing
   * data is buffered until the next call.
   *
   * @param chunk - The received text.
   * @returns The messages parsed from newly-completed lines.
   */
  push(chunk: string): RpcMessage[];
}

/**
 * Creates a {@link FrameDecoder} for the NDJSON framing used by stream
 * transports. Kept as a closure (not a class) to match the codebase's
 * preference for pure/functional building blocks; the only state is the pending
 * partial line.
 *
 * @returns A fresh {@link FrameDecoder}.
 *
 * @example
 * ```typescript
 * const decoder = createFrameDecoder();
 * socket.on("data", (chunk) => {
 *   for (const message of decoder.push(chunk.toString("utf8"))) handle(message);
 * });
 * ```
 */
export function createFrameDecoder(): FrameDecoder {
  let buffered = "";
  return {
    push(chunk: string): RpcMessage[] {
      buffered += chunk;
      const messages: RpcMessage[] = [];
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const message = decodeFrame(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (message !== undefined) messages.push(message);
        newline = buffered.indexOf("\n");
      }
      return messages;
    },
  };
}
