/**
 * @module rpc/protocol
 *
 * The shared JSON-RPC 2.0 wire protocol used by the Node keystore RPC surface —
 * both the {@link import("./server.ts").createKeyStoreRpcServer service} and the
 * drop-in {@link import("./client.ts").createRpcKeyStore client engine} depend
 * on this module so the two stay in lockstep.
 *
 * The transport is a local stream socket (a Unix domain socket, or a named pipe
 * on Windows), framed as newline-delimited JSON (NDJSON): every request,
 * response and notification is a single JSON object on its own line. Because
 * JSON has no byte type, `Uint8Array` values (signatures, public keys, seed
 * bytes, …) are carried as a small {@link BytesEnvelope} (`{ "$bytes": base64 }`)
 * and transparently re-materialized by {@link decodeValue}.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** The JSON-RPC protocol version string every envelope carries. */
export const JSON_RPC_VERSION = "2.0";

/**
 * The method name of the server → client state notification. On connect (and on
 * every subsequent change) the server pushes the current {@link KeyStoreState}
 * so a client engine can keep its reactive store hydrated without polling.
 */
export const RPC_STATE_METHOD = "state";

/** JSON-RPC 2.0 request envelope (client → server). */
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

/** JSON-RPC 2.0 response envelope (server → client). */
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
 * The JSON-RPC error codes used by the keystore RPC surface. The negative
 * range mirrors the JSON-RPC 2.0 spec; {@link operationFailed} is the
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
 * the server's allow-list so nothing outside it is ever dispatched.
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

/** A method name accepted by the RPC surface. */
export type RpcMethod = (typeof RPC_METHODS)[number];

/** Narrows an arbitrary string to a supported {@link RpcMethod}. */
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

/**
 * Recursively encodes a value for the wire, replacing every `Uint8Array` with a
 * base64 {@link BytesEnvelope}. Plain objects and arrays are walked; primitives
 * (and `Date`, which JSON serializes to an ISO string) pass through unchanged.
 *
 * @param value - The value to encode.
 * @returns A JSON-safe representation.
 */
export function encodeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") } satisfies BytesEnvelope;
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
      return Uint8Array.from(Buffer.from(value.$bytes, "base64"));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = decodeValue(item);
    }
    return out;
  }
  return value;
}

/** Serializes a message into a single NDJSON frame (a line terminated by `\n`). */
export function encodeFrame(message: RpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** A stateful decoder that turns a stream of byte chunks into whole messages. */
export interface FrameDecoder {
  /**
   * Feeds a socket chunk and returns every complete message it completed.
   * Partial trailing data is buffered until the next call.
   *
   * @param chunk - The received bytes (or string).
   * @returns The messages parsed from newly-completed lines.
   */
  push(chunk: Buffer | string): RpcMessage[];
}

/**
 * Creates a {@link FrameDecoder} for the NDJSON framing. Kept as a closure (not
 * a class) to match the codebase's preference for pure/functional building
 * blocks; the only state is the pending partial line.
 *
 * @returns A fresh {@link FrameDecoder}.
 */
export function createFrameDecoder(): FrameDecoder {
  let buffered = "";
  return {
    push(chunk: Buffer | string): RpcMessage[] {
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const messages: RpcMessage[] = [];
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.length > 0) {
          messages.push(JSON.parse(line) as RpcMessage);
        }
        newline = buffered.indexOf("\n");
      }
      return messages;
    },
  };
}

/**
 * The default socket path the service listens on and clients connect to when no
 * explicit `path` is given: a Unix domain socket under the keystore's home
 * directory, or a named pipe on Windows.
 *
 * @returns The platform-appropriate default socket path.
 */
export function defaultRpcSocketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\algorand-keystore";
  }
  return join(homedir(), ".algorand-keystore", "keystore.sock");
}
