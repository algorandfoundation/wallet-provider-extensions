import type { PasskeysOptions, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Provider } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import { remotePasskeysMirror } from "./remote.ts";
import type { RemotePasskeysMirror } from "./remote.ts";

/**
 * Options for the PasskeysConnections bridge extension.
 *
 * The same {@link PasskeysOptions} shape `WithPasskeys` reads, so one
 * options object can be threaded to both extensions. The bridge only
 * consumes `options.passkeys.store`, the **shared** TanStack store
 * instance backing the passkey state (the same instance passed to
 * `WithPasskeys`); it is required at runtime because the bridge mirrors
 * a peer's records into the passkeys store and never owns one. The
 * bridge registers no `options.passkeys` fields of its own.
 *
 * @example
 * ```typescript
 * const options: PasskeysConnectionsOptions = { passkeys: { store: passkeysStore } };
 * ```
 */
export type PasskeysConnectionsOptions = PasskeysOptions;

/**
 * The surface contributed by {@link WithPasskeysConnections}.
 *
 * @example
 * ```typescript
 * const records = provider.passkey.remote.expose();
 * ```
 */
export interface PasskeysConnectionsExtension {
  /**
   * The passkeys namespace member the bridge contributes.
   */
  passkey: {
    /**
     * The session-scoped remote mirror (see
     * {@link import("./remote.ts").remotePasskeysMirror}): the surface
     * connection engines discover to exchange passkey metadata.
     */
    remote: RemotePasskeysMirror;
  };
}

/**
 * Bridge extension that mounts the passkeys store's session-scoped
 * remote mirror at `provider.passkey.remote`, the surface the
 * connections packages' `discoverDomains` duck-types to exchange
 * passkey metadata over a session.
 *
 * Requires the shared passkeys store (`options.passkeys.store`) — the
 * same instance backing `WithPasskeys` — so mirrored records ride the
 * same reactive state the local feeders fill. Mounting is idempotent:
 * an already-mounted `provider.passkey.remote` is reused.
 *
 * @param provider - The provider instance being extended (an
 *   already-mounted `passkey.remote` is reused).
 * @param options - {@link PasskeysConnectionsOptions};
 *   `options.passkeys.store` is required.
 * @returns The {@link PasskeysConnectionsExtension}: the remote mirror at
 *   `passkey.remote`.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithPasskeys, WithPasskeysConnections]);
 * const provider = new MyProvider(config, { passkeys: { store: passkeysStore } });
 * provider.passkey.remote.receive("session-1", peerPasskeys);
 * ```
 */
export const WithPasskeysConnections = (
  provider: Provider<any> & Partial<PasskeysConnectionsExtension>,
  options?: PasskeysConnectionsOptions,
): PasskeysConnectionsExtension => {
  const store: Store<PasskeysState> | undefined = options?.passkeys?.store;
  if (!store) {
    throw new Error(
      "WithPasskeysConnections requires options.passkeys.store (the shared passkeys store)",
    );
  }

  return {
    passkey: {
      remote: provider.passkey?.remote ?? remotePasskeysMirror(store),
    },
  };
};
