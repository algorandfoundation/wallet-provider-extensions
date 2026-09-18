import { Store } from "@tanstack/store";
import type { IdentityStoreState } from "@algorandfoundation/identities";

/**
 * The single source of truth for identities in the application.
 * Uses TanStack Store for reactive state management.
 */
export const identitiesStore = new Store<IdentityStoreState>({
  identities: [],
});
