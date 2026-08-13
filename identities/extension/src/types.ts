import type { Store } from "@tanstack/store";
import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import type {
  IdentityStoreApi,
  IdentityStoreExtension,
  IdentityStoreState,
  DIDDocument,
} from "@algorandfoundation/identities-store";

/**
 * Options for the Identities extension.
 */
export interface IdentitiesExtensionOptions {
  identities?: {
    store?: Store<IdentityStoreState>;
    keystore?: {
      autoPopulate?: boolean;
    };
  };
  keystore?: {
    store: Store<KeyStoreState>;
  };
}

/**
 * Interface representing the unified Identities extension.
 */
export interface IdentitiesExtension extends IdentityStoreExtension {
  identity: {
    store: IdentityStoreApi & {
      restoreFromDidDocument(doc: DIDDocument): Promise<void>;
    };
  };
}
