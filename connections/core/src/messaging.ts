/**
 * The **secure messaging** layer of the connections domain.
 *
 * Runs over the same {@link ConnectionRpc} both peers already share:
 * outgoing text is sealed by the session's {@link SecureChannel} (the
 * key both sides derived from their identities' `keyAgreement` keys),
 * sent as the `message` method, persisted in the connections store on
 * BOTH sides, and confirmed twice: the rpc response is the delivery
 * receipt (`pending` → `delivered`), and an explicit `message_ack`
 * upgrades it to `acknowledged` once the receiving side (or its user)
 * has acknowledged the message.
 *
 * @remarks
 * This is an INFORMAL contract. A proper messaging spec will come later
 * and replace it; the flow stays deliberately small until then.
 */

import { ConnectionRpcError } from "./errors.ts";
import type { SecureChannel } from "./crypto.ts";
import type { ConnectionRpc, ConnectionRpcHandler } from "./rpc.ts";
import type {
  ConnectionMessage,
  ConnectionsStoreApi,
  MessageAckParams,
  MessageAckResult,
  SecureMessageParams,
  SecureMessageResult,
} from "./types.ts";

/**
 * The subset of the store API the messaging layer persists through.
 *
 * @example
 * ```typescript
 * const messages: MessageStoreApi = createConnectionsStore().api;
 * ```
 */
export type MessageStoreApi = Pick<
  ConnectionsStoreApi,
  "upsertMessage" | "updateMessageStatus" | "getMessage" | "getMessages"
>;

/**
 * Generates a message id: `crypto.randomUUID` where available, with a
 * `Math.random` fallback for older runtimes.
 */
function generateMessageId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Options accepted by {@link createSecureMessaging}.
 *
 * @example
 * ```typescript
 * const options: SecureMessagingOptions = { rpc, channel, sessionId, messages: api };
 * ```
 */
export interface SecureMessagingOptions {
  /** The rpc of the session's live connection (shared with connect/sign). */
  rpc: ConnectionRpc;
  /** The secure channel both peers derived from their identity keys. */
  channel: SecureChannel;
  /** The id of the session the messages belong to. */
  sessionId: string;
  /** The store the messages are persisted through. */
  messages: MessageStoreApi;
  /** Invoked with every decrypted incoming message. */
  onMessage?(message: ConnectionMessage): void;
  /**
   * Whether incoming messages are acknowledged automatically right
   * after they were persisted (default `true`). Turn off to gate the
   * ack on the application instead (e.g. "seen" semantics) and call
   * {@link SecureMessaging.acknowledge} yourself.
   */
  autoAcknowledge?: boolean;
}

/**
 * The secure messaging surface of one peer.
 *
 * @remarks
 * INFORMAL contract: the `message` / `message_ack` flow it drives is an
 * interim shape a proper messaging spec will replace.
 *
 * @example
 * ```typescript
 * const detach = messaging.attach(responder.handle);
 * const sent = await messaging.send("hello");
 * ```
 */
export interface SecureMessaging {
  /**
   * Seals and sends a text message, persisting it locally.
   *
   * The returned message is `delivered` when the peer confirmed
   * receipt. On failure the message is persisted as `failed` and the
   * error is re-thrown.
   */
  send(text: string): Promise<ConnectionMessage>;
  /**
   * Explicitly acknowledges a received message: sends `message_ack` to
   * the sender and marks the local copy `acknowledged`.
   */
  acknowledge(messageId: string): Promise<ConnectionMessage | undefined>;
  /** Whether the messaging layer answers the given rpc method. */
  handles(method: string): boolean;
  /**
   * Answers a `message`/`message_ack` request. Throws
   * {@link ConnectionRpcError} `method_not_found` for anything else.
   */
  handle(method: string, params: unknown): Promise<unknown>;
  /**
   * Registers the messaging layer as the rpc's request handler,
   * delegating methods it does not handle to `fallback` (e.g. the
   * wallet responder's handler); rpcs allow only one active handler,
   * so composition happens here.
   *
   * @returns An unregister function.
   */
  attach(fallback?: ConnectionRpcHandler): () => void;
}

/**
 * Creates the {@link SecureMessaging} layer of one peer.
 *
 * Both sides of a connection build one over their end of the rpc with
 * the SAME secure channel key (each derives it from its own private
 * key and the peer's `keyAgreement` public key).
 *
 * @param options - {@link SecureMessagingOptions}.
 * @returns The {@link SecureMessaging} surface.
 *
 * @example
 * ```typescript
 * const messaging = createSecureMessaging({
 *   rpc,
 *   channel,
 *   sessionId: session.id,
 *   messages: api,
 *   onMessage: (message) => render(message),
 * });
 * const detach = messaging.attach(responderHandler);
 * const sent = await messaging.send("hello over the shared key");
 * ```
 */
export function createSecureMessaging(options: SecureMessagingOptions): SecureMessaging {
  const { rpc, channel, sessionId, messages } = options;
  const autoAcknowledge = options.autoAcknowledge ?? true;

  const acknowledge = async (messageId: string): Promise<ConnectionMessage | undefined> => {
    const message = await messages.getMessage(messageId);
    if (!message || message.direction !== "incoming") {
      throw new ConnectionRpcError("unknown_message", `no incoming message ${messageId}`);
    }
    if (message.status === "acknowledged") return message;
    await rpc.request("message_ack", { id: messageId });
    return (await messages.updateMessageStatus(messageId, "acknowledged")) ?? message;
  };

  const handleMessage = async (params: SecureMessageParams): Promise<SecureMessageResult> => {
    if (
      !params ||
      typeof params.id !== "string" ||
      typeof params.nonce !== "string" ||
      typeof params.ciphertext !== "string"
    ) {
      throw new ConnectionRpcError("invalid_params", "malformed message params");
    }

    let text: string;
    try {
      text = channel.decryptText({ nonce: params.nonce, ciphertext: params.ciphertext });
    } catch {
      throw new ConnectionRpcError(
        "decrypt_failed",
        "message could not be decrypted with the session's shared key",
      );
    }

    // Re-deliveries of an already-stored id are confirmed idempotently
    // without duplicating the record.
    const existing = await messages.getMessage(params.id);
    let message = existing;
    if (!existing) {
      const now = Date.now();
      message = await messages.upsertMessage({
        id: params.id,
        sessionId,
        direction: "incoming",
        text,
        status: "received",
        createdAt: now,
        updatedAt: now,
      });
      options.onMessage?.(message);
      if (autoAcknowledge) {
        // After the delivery receipt below went out; the ack is its own
        // request in the opposite direction, not part of this response.
        queueMicrotask(() => {
          void acknowledge(params.id).catch(() => {
            // The sender keeps the message `delivered`; an application
            // can retry via `acknowledge` once the transport recovers.
          });
        });
      }
    }
    return { id: params.id, received: true };
  };

  const handleMessageAck = async (params: MessageAckParams): Promise<MessageAckResult> => {
    if (!params || typeof params.id !== "string") {
      throw new ConnectionRpcError("invalid_params", "malformed message_ack params");
    }
    const message = await messages.getMessage(params.id);
    if (!message || message.direction !== "outgoing") {
      throw new ConnectionRpcError("unknown_message", `no outgoing message ${params.id}`);
    }
    if (message.status !== "acknowledged") {
      await messages.updateMessageStatus(params.id, "acknowledged");
    }
    return { id: params.id, acknowledged: true };
  };

  const handle = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case "message":
        return handleMessage(params as SecureMessageParams);
      case "message_ack":
        return handleMessageAck(params as MessageAckParams);
      default:
        throw new ConnectionRpcError("method_not_found", `unknown method ${method}`);
    }
  };

  return {
    async send(text: string): Promise<ConnectionMessage> {
      const id = generateMessageId();
      const now = Date.now();
      const message = await messages.upsertMessage({
        id,
        sessionId,
        direction: "outgoing",
        text,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      const sealed = channel.encrypt(text);
      try {
        await rpc.request("message", { id, nonce: sealed.nonce, ciphertext: sealed.ciphertext });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        await messages.updateMessageStatus(id, "failed", detail);
        throw e;
      }
      // The peer's explicit ack may race ahead of this delivery receipt;
      // the store never downgrades `acknowledged`, so the returned
      // message is whichever confirmation landed last.
      return (await messages.updateMessageStatus(id, "delivered")) ?? message;
    },

    acknowledge,

    handles(method: string): boolean {
      return method === "message" || method === "message_ack";
    },

    handle,

    attach(fallback?: ConnectionRpcHandler): () => void {
      return rpc.onRequest(async (method, params) => {
        if (method === "message" || method === "message_ack") {
          return handle(method, params);
        }
        if (fallback) return fallback(method, params);
        throw new ConnectionRpcError("method_not_found", `unknown method ${method}`);
      });
    },
  };
}
