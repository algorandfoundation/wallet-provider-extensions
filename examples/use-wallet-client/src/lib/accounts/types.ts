import type { WalletAccount } from "@txnlab/use-wallet/adapter";

/**
 * A use-wallet account as the Provider adapter surfaces it: the base
 * `WalletAccount` (use-wallet v5 already carries free-form `metadata`)
 * plus the wallet-side account `type` from the connect handshake. The
 * adapter honors whatever the wallet transmitted and lets it through
 * verbatim, e.g. `metadata.keyType` distinguishing an HD account from
 * a standalone Ed25519 key account from a post-quantum Falcon account
 * (see `../ui/accountKinds.ts` for the display mapping).
 */
export interface ProviderWalletAccount extends WalletAccount {
  /** The wallet-side account type (e.g. `keystore-account`, `watched`). */
  type?: string;
}
