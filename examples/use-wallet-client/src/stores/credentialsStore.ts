import { Store } from "@tanstack/store";
import type { CredentialStoreState } from "@algorandfoundation/credentials";

/**
 * The reactive store backing the Provider's credentials, the credentials
 * domain's SINGLE SOURCE OF TRUTH. In this dapp it holds the credential
 * metadata the connected wallet exposed over the connect handshake (see
 * `../lib/credentials/walletCredentials.ts`): the adapter records it for
 * the session's lifetime, and the `WalletCredentialsPanel` reads it from
 * here, never from the connections store.
 */
export const credentialsStore = new Store<CredentialStoreState>({
  credentials: [],
  issuanceSessions: [],
  verificationSessions: [],
});
