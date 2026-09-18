import type { PasskeysExtension, PasskeysOptions } from "@algorandfoundation/passkeys-core";
import type { RemotePasskeysMirror } from "@algorandfoundation/passkeys-connections-extension";

/**
 * Options for the unified Passkeys extension.
 *
 * The `passkeys` slice is the core store's (`PasskeysOptions`, i.e. the
 * shared `options.passkeys` namespace): the lazily loaded connections
 * bridge (`@algorandfoundation/passkeys-connections-extension`) reads the
 * same shared store off it and takes no options of its own.
 *
 * @example
 * ```typescript
 * const options: PasskeysMetaOptions = { passkeys: { store: passkeysStore } };
 * ```
 */
export type PasskeysMetaOptions = PasskeysOptions;

/**
 * Interface representing the unified Passkeys extension.
 *
 * @example
 * ```typescript
 * await provider.passkey.store.ready;
 * provider.passkey.remote?.receive(sessionId, peerPasskeys);
 * ```
 */
export interface PasskeysMetaExtension extends PasskeysExtension {
  passkey: PasskeysExtension["passkey"] & {
    store: PasskeysExtension["passkey"]["store"] & {
      /**
       * Resolves once this extension's dynamic bridge import has settled
       * (mounted, or swallowed when the connections peer is not
       * installed) — the passkeys counterpart of the keystore's
       * `KeyStore.ready`. Never rejects. After it resolves,
       * `provider.passkey.remote` is present whenever
       * `@algorandfoundation/passkeys-connections-extension` is
       * installed, so `await provider.passkey.store.ready` before
       * initiating a connection guarantees the first handshake
       * exchanges records instead of degrading to announce-only.
       */
      ready: Promise<void>;
    };
    /**
     * The session-scoped remote mirror contributed by the connections
     * bridge: the surface connection engines discover to exchange
     * passkey metadata. Attached asynchronously once
     * `@algorandfoundation/passkeys-connections-extension` resolves;
     * absent when the peer is not installed.
     */
    remote?: RemotePasskeysMirror;
  };
}
