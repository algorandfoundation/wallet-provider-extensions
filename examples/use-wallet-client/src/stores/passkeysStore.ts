import { Store } from "@tanstack/store";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";

/**
 * The reactive store backing the Provider's passkeys, the passkeys
 * domain's SINGLE SOURCE OF TRUTH. In this dapp the inventory is fed by
 * the connections engine: it discovers the passkeys domain's remote
 * mirror (`provider.passkey.remote`) and writes the passkey metadata the
 * connected wallet exposed over the connect handshake into this store
 * for the session's lifetime, and the `WalletPasskeysPanel` reads it
 * from here, never from the connections store.
 */
export const passkeysStore = new Store<PasskeysState>({ passkeys: [] });
