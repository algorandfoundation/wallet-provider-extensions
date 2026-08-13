import type {
  IdentityStoreApi,
  IdentityStoreOptions,
  DIDDocument,
} from "@algorandfoundation/identities-store";
import type { KeyStoreOptions } from "@algorandfoundation/keystore-core";

/**
 * Options for the IdentitiesKeystore extension.
 */
export interface IdentitiesKeystoreExtensionOptions extends KeyStoreOptions, IdentityStoreOptions {
  identities: IdentityStoreOptions["identities"] & {
    keystore?: {
      /**
       * Automatically populate the identity store from the keystore.
       * @default true
       */
      autoPopulate?: boolean;
    };
  };
}

/**
 * Interface representing the IdentitiesKeystore extension.
 */
export interface IdentitiesKeystoreExtension {
  identity: {
    store: IdentityStoreApi & {
      /**
       * Recreates the keystore state (derived keys) based on the provided DID Document.
       * @param doc The DID Document to restore from.
       */
      restoreFromDidDocument: (doc: DIDDocument) => Promise<void>;
    };
  };
}
