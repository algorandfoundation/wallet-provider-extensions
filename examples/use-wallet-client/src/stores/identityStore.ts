import { Store } from "@tanstack/store";
import type { IdentityStoreState } from "@algorandfoundation/identities";
import type { DappIdentity } from "../lib/identities/types.ts";

/** The reactive store backing the Provider's identities (local + remote). */
export const identityStore = new Store<IdentityStoreState<DappIdentity>>({ identities: [] });
