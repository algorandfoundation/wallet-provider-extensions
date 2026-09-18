import type {
  CredentialsNamespace,
  CredentialStoreState,
} from "@algorandfoundation/credentials-core";
import type { ExtensionOptions, Provider } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import { remoteCredentialsMirror } from "./remote.ts";
import type { RemoteCredentialsMirror } from "./remote.ts";

/**
 * Options for the CredentialsConnections bridge extension.
 *
 * The bridge reads a single member of the shared `options.credentials`
 * namespace ({@link CredentialsNamespace}, owned by
 * `@algorandfoundation/credentials-core`): `credentials.store`, the
 * **shared** TanStack store instance backing the credential state — the same
 * instance the `createCredentialStore` engine resolved. It is required here:
 * the bridge mirrors a peer's records into the credential store, it never
 * owns one. Because it is the same namespace the platform `WithCredentials`
 * extensions read, one options object threads to both extensions.
 *
 * @example
 * ```typescript
 * const options: CredentialsConnectionsOptions = { credentials: { store: credentialStore } };
 * ```
 */
export interface CredentialsConnectionsOptions extends ExtensionOptions {
  /** Credentials-specific settings; only `store` is read by the bridge. */
  credentials?: CredentialsNamespace;
}

/**
 * The surface contributed by {@link WithCredentialsConnections}.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithCredentials, WithCredentialsConnections]);
 * const provider = new MyProvider(config, { credentials: { store } });
 * provider.credential.remote.expose(); // records shared with peers
 * ```
 */
export interface CredentialsConnectionsExtension {
  /**
   * The credentials namespace member the bridge contributes.
   */
  credential: {
    /**
     * The session-scoped remote mirror (see
     * {@link import("./remote.ts").remoteCredentialsMirror}): the surface
     * connection engines discover to exchange credential metadata.
     */
    remote: RemoteCredentialsMirror;
  };
}

/**
 * Bridge extension that mounts the credential store's session-scoped
 * remote mirror at `provider.credential.remote`, the surface the
 * connections packages' `discoverDomains` duck-types to exchange
 * credential metadata over a session.
 *
 * Requires the shared credential store (`options.credentials.store`) — the
 * same instance backing the platform `WithCredentials` extensions — so
 * mirrored records ride the same reactive state the local credentials live
 * in. Mounting is idempotent: an already-mounted
 * `provider.credential.remote` is reused.
 *
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The credentials-connections bridge extension.
 *
 * @example
 * ```typescript
 * const store = new Store<CredentialStoreState>({
 *   credentials: [],
 *   issuanceSessions: [],
 *   verificationSessions: [],
 * });
 * const MyProvider = Provider.withExtensions([WithCredentials, WithCredentialsConnections]);
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   { credentials: { store } },
 * );
 * ```
 */
export const WithCredentialsConnections = (
  provider: Provider<any> & Partial<CredentialsConnectionsExtension>,
  options?: CredentialsConnectionsOptions,
): CredentialsConnectionsExtension => {
  const store: Store<CredentialStoreState> | undefined = options?.credentials?.store;
  if (!store) {
    throw new Error(
      "WithCredentialsConnections requires options.credentials.store (the shared credential store)",
    );
  }

  return {
    credential: {
      remote: provider.credential?.remote ?? remoteCredentialsMirror(store),
    },
  };
};
