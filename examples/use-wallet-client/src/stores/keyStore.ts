import { Store } from "@tanstack/store";
import type { KeyStoreState } from "@algorandfoundation/keystore";

/**
 * The reactive store backing the local browser keystore. UI-safe: it only
 * mirrors key metadata (ids, algorithms, public keys); private material
 * stays inside non-extractable WebCrypto keys in IndexedDB.
 */
export const keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" });
