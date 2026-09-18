import type { KeyStoreOptions } from "@algorandfoundation/keystore-core";
import type { PasskeysNamespace, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Store } from "@tanstack/store";

/**
 * The keystore-bridge settings the bridge reads from
 * `options.passkeys.keystore`.
 *
 * @example
 * ```typescript
 * const bridge: PasskeysKeystoreNamespace = { autoPopulate: false };
 * ```
 */
export interface PasskeysKeystoreNamespace {
  /**
   * Whether to automatically add passkeys for all compatible keys in the
   * keystore. Defaults to true.
   */
  autoPopulate?: boolean;
}

declare module "@algorandfoundation/passkeys-core" {
  /**
   * Keystore-bridge additions to the shared `options.passkeys` namespace:
   * the `keystore` block {@link WithPasskeysKeystore} reads. The reactive
   * `store`, `hooks` and `log` come from the base {@link PasskeysNamespace}.
   */
  interface PasskeysNamespace {
    /** Keystore-bridge settings, see {@link PasskeysKeystoreNamespace}. */
    keystore?: PasskeysKeystoreNamespace;
  }
}

/**
 * Options for the PasskeysKeystore extension.
 *
 * Narrows the shared `ExtensionOptions` registry (via the keystore's
 * {@link KeyStoreOptions}, whose `keystore` block is required): the bridge
 * needs both the `passkeys` block (with a **required** shared `store`, the
 * same instance backing `WithPasskeys`) and the keystore's `keystore` block
 * (the reactive key store it observes). The bridge-specific
 * `passkeys.keystore` settings are registered by this package on the
 * {@link PasskeysNamespace}.
 *
 * @example
 * ```typescript
 * const options: PasskeysKeystoreExtensionOptions = {
 *   passkeys: { store: passkeysStore, keystore: { autoPopulate: true } },
 *   keystore: { store: keyStore, hooks: keyStoreHooks },
 * };
 * ```
 */
export interface PasskeysKeystoreExtensionOptions extends KeyStoreOptions {
  /** Passkeys-specific settings; the shared `store` is required. */
  passkeys: PasskeysNamespace & {
    /**
     * The TanStack store instance backing the passkey state.
     * Required; the extension populates it from the keystore.
     */
    store: Store<PasskeysState>;
  };
}
