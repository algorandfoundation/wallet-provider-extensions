import type { WalletAccount } from "@txnlab/use-wallet-react";
import type { ProviderWalletAccount } from "../accounts/types.ts";

/** How an account kind renders: its friendly name and chip modifier. */
export interface AccountKind {
  /** Friendly display name of the account kind (e.g. "HD Account"). */
  label: string;
  /** Chip color modifier appended to `chip account-kind`. */
  chip: string;
}

/**
 * Display kind per keystore account, keyed by the backing key's type
 * (`metadata.keyType`, recorded by the accounts-keystore bridge and
 * transmitted by the wallet on connect): an HD account (BIP32-Ed25519
 * derived), a standalone Ed25519 key account, or a post-quantum Falcon
 * account (addressed per go-algorand v5's native Falcon accounts).
 * Mirrors the labels of the react-native-wallet example.
 */
const KEY_TYPE_KINDS: Record<string, AccountKind> = {
  "hd-derived-ed25519": { label: "HD Account", chip: "hd" },
  ed25519: { label: "Ed25519 Account", chip: "ed25519" },
  "falcon-1024": { label: "Falcon Account", chip: "falcon" },
};

/** Display kind per wallet-side account type without a known key type. */
const ACCOUNT_TYPE_KINDS: Record<string, AccountKind> = {
  "keystore-account": { label: "Keystore Account", chip: "keystore" },
  watched: { label: "Watched Account", chip: "watched" },
};

/**
 * Resolves the display kind of a use-wallet account from the `type` and
 * `metadata` the wallet transmitted over the connect handshake (see
 * `ProviderWalletAccount` in `../accounts/types.ts`): the backing key's type wins
 * (HD vs Ed25519 vs Falcon), then the account type (keystore vs
 * watched). Accounts of wallets that expose no type information (e.g.
 * Pera) resolve to `null`, meaning no badge.
 */
export function accountKind(account: WalletAccount): AccountKind | null {
  const { type, metadata } = account as ProviderWalletAccount;
  const keyType = metadata?.keyType;
  if (typeof keyType === "string" && KEY_TYPE_KINDS[keyType]) {
    return KEY_TYPE_KINDS[keyType];
  }
  if (type && ACCOUNT_TYPE_KINDS[type]) {
    return ACCOUNT_TYPE_KINDS[type];
  }
  return null;
}
