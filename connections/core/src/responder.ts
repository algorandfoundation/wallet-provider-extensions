/**
 * The wallet-side responder answering dapp requests over a
 * {@link ConnectionRpc}.
 *
 * The responder is a **structural seam**: the wallet supplies a domain
 * registry for inventory exchange and a plain callback for transaction
 * signing, so this package never depends on the domain extension
 * packages. Any wallet (or test double) that can expose domain records
 * and sign transaction bytes plugs in.
 */

import { ConnectionRpcError } from "./errors.ts";
import type { ConnectionDomainRegistry } from "./domains.ts";
import type { ConnectionRpc } from "./rpc.ts";
import type {
  ConnectParams,
  ConnectResult,
  SignTransactionsParams,
  SignTransactionsResult,
} from "./types.ts";

/** Encodes bytes as standard base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decodes standard base64 into bytes. */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Context accompanying a `connect` approval: which session the
 * handshake belongs to and whether it renegotiates an already-approved
 * pairing. Populated by protocol responders that track sessions (e.g.
 * the liquid-auth responder wraps the wallet seams per transport);
 * absent when a host attaches the responder to a bare transport itself.
 *
 * @example
 * ```typescript
 * approveConnect: (params, context) => context?.resumed || promptUser(params),
 * ```
 */
export interface ConnectApprovalContext {
  /** The id of the session the handshake belongs to (the requestId). */
  sessionId?: string;
  /**
   * True when the handshake renegotiates an already-approved pairing (a
   * resume of a persisted session) rather than establishing a brand-new
   * one. Hosts typically skip the user prompt for these, since the
   * user already approved the pairing when it was first accepted.
   */
  resumed?: boolean;
}

/**
 * Options accepted by {@link createWalletResponder}.
 *
 * @example
 * ```typescript
 * const options: CreateWalletResponderOptions = {
 *   signTransactions: (txns) => wallet.sign(txns),
 *   metadata: { name: "My Wallet" },
 * };
 * ```
 */
export interface CreateWalletResponderOptions {
  /**
   * The registry of the wallet's connection domains (typically the one
   * the hosting engine discovered from the provider surface; see
   * `discoverDomains`). `connect` answers with `registry.expose()` and
   * routes the dapp's inbound `params.domains` to `registry.receive()`.
   * Without a registry `connect` returns `domains: {}`: the handshake
   * still succeeds, announcing no domains.
   */
  domains?: ConnectionDomainRegistry;
  /**
   * The id of the session the responder answers for, scoping the
   * registry's `receive()` of inbound `params.domains`. Populated by
   * protocol responders that track sessions; when absent (a host
   * attaching the responder to a bare transport), inbound records are
   * not routed, as there is no session to mirror them under.
   */
  sessionId?: string;
  /**
   * Signs the given transactions (decoded transaction msgpack).
   *
   * Must return an array aligned position-for-position with `txns`:
   * signed transaction bytes where signed, `null` where not.
   *
   * @param txns - The decoded transactions of the group.
   * @param indexesToSign - Positions to sign; all when omitted.
   */
  signTransactions(txns: Uint8Array[], indexesToSign?: number[]): Promise<(Uint8Array | null)[]>;
  /** Display metadata of the wallet, returned from `connect`. */
  metadata?: {
    name?: string;
    icon?: string;
  };
  /**
   * Approval gate for `connect`, typically a user prompt. Returning
   * `false` rejects the request with code `rejected`. Approved when omitted.
   *
   * Protocol responders that track sessions pass a
   * {@link ConnectApprovalContext} so hosts can auto-approve the
   * handshake of a resumed (already-approved) pairing.
   */
  approveConnect?(
    params: ConnectParams,
    context?: ConnectApprovalContext,
  ): boolean | Promise<boolean>;
  /**
   * Approval gate for `sign_transactions`, typically a user prompt.
   * Returning `false` rejects the request with code `rejected`.
   * Approved when omitted.
   */
  approveSignTransactions?(params: SignTransactionsParams): boolean | Promise<boolean>;
}

/**
 * The wallet-side responder returned by {@link createWalletResponder}.
 *
 * @example
 * ```typescript
 * const detach = responder.attach(createConnectionRpc(transport));
 * ```
 */
export interface WalletResponder {
  /** Whether the responder answers the given rpc method. */
  handles(method: string): boolean;
  /**
   * Answers a `connect`/`sign_transactions` request. Throws
   * {@link ConnectionRpcError} `method_not_found` for anything else.
   * Exposed so protocol responders can compose the wallet responder
   * with other handlers (e.g. the secure-messaging layer), since rpcs allow
   * only one active request handler.
   */
  handle(method: string, params: unknown): Promise<unknown>;
  /**
   * Registers the responder as the rpc's request handler.
   *
   * @returns An unregister function.
   */
  attach(rpc: ConnectionRpc): () => void;
}

/**
 * Creates the wallet-side responder answering the `connect` and
 * `sign_transactions` methods of the wallet RPC.
 *
 * Denied approvals reject with {@link ConnectionRpcError} code
 * `rejected`; unknown methods reject with code `method_not_found`. Both
 * travel back to the dapp inside the response envelope's `error.code`.
 *
 * @param options - {@link CreateWalletResponderOptions}.
 * @returns The {@link WalletResponder}.
 *
 * @example
 * ```typescript
 * const responder = createWalletResponder({
 *   domains: createDomainRegistry(discoverDomains(provider)),
 *   signTransactions: (txns, indexesToSign) => wallet.sign(txns, indexesToSign),
 *   metadata: { name: "My Wallet" },
 *   approveConnect: (params) => promptUser(params),
 * });
 * const detach = responder.attach(createConnectionRpc(transport));
 * ```
 */
export function createWalletResponder(options: CreateWalletResponderOptions): WalletResponder {
  const handleConnect = async (params: ConnectParams): Promise<ConnectResult> => {
    if (options.approveConnect && !(await options.approveConnect(params))) {
      throw new ConnectionRpcError("rejected", "connection rejected");
    }
    // Route the dapp's inbound records to the domain stores first; the
    // registry logs-and-skips per-domain failures, so a bad inbound
    // payload never fails the handshake.
    if (options.domains && options.sessionId && params.domains) {
      await options.domains.receive(options.sessionId, params.domains);
    }
    const domains = options.domains ? await options.domains.expose() : {};
    return {
      domains,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
  };

  const handleSignTransactions = async (
    params: SignTransactionsParams,
  ): Promise<SignTransactionsResult> => {
    if (options.approveSignTransactions && !(await options.approveSignTransactions(params))) {
      throw new ConnectionRpcError("rejected", "signing rejected");
    }
    const txns = params.txns.map(base64ToBytes);
    const signed = await options.signTransactions(txns, params.indexesToSign);
    return { stxns: signed.map((stxn) => (stxn === null ? null : bytesToBase64(stxn))) };
  };

  const handle = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case "connect":
        return handleConnect((params ?? {}) as ConnectParams);
      case "sign_transactions":
        return handleSignTransactions(params as SignTransactionsParams);
      default:
        throw new ConnectionRpcError("method_not_found", `unknown method ${method}`);
    }
  };

  return {
    handles(method: string): boolean {
      return method === "connect" || method === "sign_transactions";
    },

    handle,

    attach(rpc: ConnectionRpc): () => void {
      return rpc.onRequest(handle);
    },
  };
}
