/**
 * The session-scoped **remote mirror** of the accounts store.
 *
 * Pure, connection-agnostic store code: a remote peer's accounts land
 * under a session-scoped wallet key (`remote:<sessionId>`) in the same
 * reactive state the local wallets live in, and leave again when the
 * session ends. The surface (`{ expose, receive, revoke }`) is mounted
 * by `WithAccountsConnections` at `provider.account.remote`, the
 * accounts side of the connections packages' domain seam. The receive
 * context is a **type-only** import of the seam's `DomainReceiveContext`
 * (`@algorandfoundation/connections-core`), so no runtime dependency
 * exists in either direction.
 *
 * The wire type is simply the store's {@link Account}: the store holds
 * nothing but public projections (key-scheme info rides `metadata`), so
 * records travel as data. The one thing that differs between a local
 * and a remote account is how `sign` is backed (secret material in the
 * local engine vs a session-routed RPC), so `receive` re-attaches the
 * signer the caller passes in its context.
 */

import type {
  Account,
  AccountStoreState,
  BaseAccount,
  WalletKey,
} from "@algorandfoundation/accounts-core";
import type { DomainReceiveContext } from "@algorandfoundation/connections-core";
import type { Store } from "@tanstack/store";

/**
 * The wallet-key prefix session mirrors are stored under.
 *
 * @example
 * ```typescript
 * const isMirror = walletKey.startsWith(REMOTE_WALLET_PREFIX);
 * ```
 */
export const REMOTE_WALLET_PREFIX: string = "remote:";

/**
 * The session-scoped wallet key a peer's accounts are mirrored under.
 *
 * @param sessionId - The id of the session the records belong to.
 * @returns The mirror's {@link WalletKey}.
 *
 * @example
 * ```typescript
 * const peerAccounts = store.state.wallets[remoteWalletKey("session-1")]?.accounts ?? [];
 * ```
 */
export function remoteWalletKey(sessionId: string): WalletKey {
  return `${REMOTE_WALLET_PREFIX}${sessionId}`;
}

/**
 * Whether a wallet key belongs to a session mirror (see
 * {@link remoteWalletKey}).
 *
 * @param walletKey - The wallet key to test.
 * @returns `true` for `remote:<sessionId>` keys.
 *
 * @example
 * ```typescript
 * const localKeys = Object.keys(store.state.wallets).filter((k) => !isRemoteWalletKey(k));
 * ```
 */
export function isRemoteWalletKey(walletKey: WalletKey): boolean {
  return walletKey.startsWith(REMOTE_WALLET_PREFIX);
}

/**
 * The remote-mirror surface mounted at `provider.account.remote`.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * const records = provider.account.remote.expose();
 * provider.account.remote.receive("session-1", peerRecords, { sign: sessionSigner });
 * provider.account.remote.revoke("session-1");
 * ```
 */
export interface RemoteAccountsMirror<T extends BaseAccount = Account> {
  /**
   * The local wallet's accounts as data-only records: what this side
   * shares with a peer. Session mirrors are excluded (no echo) and
   * function members are stripped (behavior never travels the wire).
   */
  expose(): T[];
  /**
   * Mirrors a peer's accounts under the session's wallet key, replacing
   * any previous mirror for the session and re-attaching `sign` from
   * the context per record.
   */
  receive(sessionId: string, records: T[], context?: DomainReceiveContext): void;
  /** Drops the session's mirror. */
  revoke(sessionId: string): void;
}

/**
 * Options accepted by {@link remoteAccountsMirror}.
 *
 * @template T - The account type held by the store.
 *
 * @example
 * ```typescript
 * const options: RemoteAccountsMirrorOptions = {
 *   walletKey: "my-wallet",
 *   expose: (accounts) => accounts.map(({ metadata, ...rest }) => rest),
 * };
 * ```
 */
export interface RemoteAccountsMirrorOptions<T extends BaseAccount = Account> {
  /**
   * The local wallet key {@link RemoteAccountsMirror.expose} lists.
   * Defaults to the store's `activeWallet` at expose time.
   */
  walletKey?: WalletKey;
  /**
   * Overrides the outbound projection of
   * {@link RemoteAccountsMirror.expose}: filter accounts, trim metadata,
   * or normalize addresses (e.g. keystore-bridged accounts keyed by
   * base64 public key → canonical Algorand addresses) before they
   * travel the wire. Receives (and must return) data-only records.
   */
  expose?: (accounts: T[]) => T[];
}

/** Strips function members; records travel the wire as data only. */
function toDataRecord<T>(record: T): T {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(
      ([, value]) => typeof value !== "function",
    ),
  ) as T;
}

/**
 * Creates the accounts store's session-scoped remote mirror.
 *
 * @param store - The TanStack store instance backing the accounts state.
 * @param options - {@link RemoteAccountsMirrorOptions}.
 * @returns The {@link RemoteAccountsMirror}.
 *
 * @example
 * ```typescript
 * const remote = remoteAccountsMirror(store, { walletKey: provider.id });
 * remote.receive("session-1", peerAccounts, { sign: sessionSigner });
 * // ... the peer's accounts now ride the same reactive state ...
 * remote.revoke("session-1");
 * ```
 */
export function remoteAccountsMirror<
  T extends BaseAccount = Account,
  S extends AccountStoreState<T> = AccountStoreState<T>,
>(store: Store<S>, options: RemoteAccountsMirrorOptions<T> = {}): RemoteAccountsMirror<T> {
  return {
    expose(): T[] {
      const walletKey = options.walletKey ?? store.state.activeWallet;
      if (!walletKey || isRemoteWalletKey(walletKey)) return [];
      const accounts = (store.state.wallets[walletKey]?.accounts ?? []).map(toDataRecord);
      return options.expose ? options.expose(accounts) : accounts;
    },

    receive(sessionId: string, records: T[], context?: DomainReceiveContext): void {
      const accounts = records.map((record) => {
        const data = toDataRecord(record);
        return (context?.sign ? { ...data, sign: context.sign(data) } : data) as T;
      });
      store.setState((state: S): S => {
        return {
          ...state,
          wallets: {
            ...state.wallets,
            [remoteWalletKey(sessionId)]: {
              accounts,
              activeAccount: accounts[0] ?? null,
            },
          },
        } as S;
      });
    },

    revoke(sessionId: string): void {
      const walletKey = remoteWalletKey(sessionId);
      store.setState((state: S): S => {
        if (!state.wallets[walletKey]) return state;
        const wallets = { ...state.wallets };
        delete wallets[walletKey];
        return {
          ...state,
          wallets,
          activeWallet: state.activeWallet === walletKey ? null : state.activeWallet,
        } as S;
      });
    },
  };
}
