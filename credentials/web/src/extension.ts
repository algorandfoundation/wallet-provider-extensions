import {
  createCredentialStore,
  identityHolderBinding,
  memoryCredentialDriver,
  type CredentialStoreApi,
  type CredentialStoreExtension,
  type CredentialStoreOptions,
  type DigitalCredentialsPlatform,
  type HolderIdentityStore,
} from "@algorandfoundation/credentials-core";
import type {
  RemoteCredentialsMirror,
  WithCredentialsConnections as WithCredentialsConnectionsType,
} from "@algorandfoundation/credentials-connections-extension";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { localStorageCredentialDriver } from "./driver.ts";
import { webDigitalCredentials } from "./platform.ts";

/**
 * Browser credentials extension options.
 *
 * The same {@link CredentialStoreOptions} shape: the browser package adds no
 * platform seam of its own to the shared `options.credentials` namespace, so
 * the block accepts the base `store`/`hooks`/`driver`/`binding`/`storageKey`
 * (with {@link localStorageCredentialDriver} as the default driver).
 *
 * @example
 * ```typescript
 * const options: WebCredentialsOptions = {
 *   credentials: { driver: localStorageCredentialDriver(sessionStorage) },
 * };
 * ```
 */
export type WebCredentialsOptions = CredentialStoreOptions;

/**
 * The extension surface contributed by the browser credentials package:
 * the platform-neutral credential store plus the browser
 * {@link DigitalCredentialsPlatform} at `provider.credential.digital`.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithCredentials]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, {});
 * if (provider.credential.digital.isSupported()) {
 *   await provider.credential.digital.get({ requests });
 * }
 * ```
 */
export interface WebCredentialsExtension extends CredentialStoreExtension {
  credential: {
    store: CredentialStoreApi & {
      /**
       * Resolves once the engine's driver hydration and this extension's
       * dynamic bridge import have settled (mounted, or swallowed when
       * the connections peer is not installed) — the credentials
       * counterpart of the keystore's `KeyStore.ready`. Never rejects.
       * After it resolves, `provider.credential.remote` is present
       * whenever `@algorandfoundation/credentials-connections-extension`
       * is installed, so `await provider.credential.store.ready` before
       * initiating a connection guarantees the first handshake exchanges
       * records instead of degrading to announce-only.
       */
      ready: Promise<void>;
    };
    /**
     * The session-scoped remote mirror contributed by the connections
     * bridge: the surface connection engines discover to exchange
     * credential metadata. Attached asynchronously once
     * `@algorandfoundation/credentials-connections-extension` resolves;
     * absent when the peer is not installed.
     */
    remote?: RemoteCredentialsMirror;
    digital: DigitalCredentialsPlatform;
  };
}

/**
 * Wallet Provider Extension that adds browser credentials functionality.
 *
 * A thin Provider/Extensions wrapper around the shared `createCredentialStore`
 * engine from `@algorandfoundation/credentials-core`, the same pattern every
 * keystore platform package follows with `WithKeyStore`/`createKeyStore`:
 *
 * - **Persistence** comes from `options.credentials.driver` when injected,
 *   otherwise the browser default ({@link localStorageCredentialDriver}); a
 *   memory driver is the last resort when `localStorage` is unavailable.
 * - **Holder binding** comes from `options.credentials.binding` when
 *   injected, otherwise `identityHolderBinding(provider.identity.store)` is
 *   auto-wired when an identities extension is mounted. Without either, the
 *   store still mounts: `getSignerForIdentity` resolves `undefined` and no
 *   removal cascade is wired.
 * - The browser Digital Credentials implementation is attached at
 *   `provider.credential.digital`: {@link webDigitalCredentials}, which
 *   feature-detects `navigator.credentials.get({ digital })` and forwards
 *   requests to the user agent where supported.
 * - The connections bridge
 *   (`@algorandfoundation/credentials-connections-extension`) is loaded
 *   lazily to mount the session-scoped remote mirror at
 *   `provider.credential.remote` over the engine-resolved store; a missing
 *   bridge peer degrades silently to a local-only credentials surface.
 *   `provider.credential.store.ready` resolves once the import settled.
 *
 * @param provider - The host provider (may carry `log` and `identity` extensions).
 * @param options - {@link WebCredentialsOptions}; every `options.credentials` member is optional.
 * @returns The {@link WebCredentialsExtension} surface.
 *
 * @example
 * ```typescript
 * import { Provider } from "@algorandfoundation/wallet-provider";
 * import { WithIdentities } from "@algorandfoundation/identities-core";
 * import { WithCredentials } from "@algorandfoundation/credentials-web";
 *
 * const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
 * const provider = new MyProvider({ id: "my-provider", name: "My Provider" }, {});
 * await provider.credential.store.ready;
 * ```
 */
export const WithCredentials: Extension<WebCredentialsExtension> = (
  provider: Provider<any> &
    Partial<LogStoreExtension> & { identity?: { store?: HolderIdentityStore } },
  options: WebCredentialsOptions,
) => {
  const binding =
    options?.credentials?.binding ??
    (provider.identity?.store ? identityHolderBinding(provider.identity.store) : undefined);
  const driver =
    options?.credentials?.driver ??
    (typeof globalThis.localStorage === "undefined"
      ? memoryCredentialDriver()
      : localStorageCredentialDriver());

  const {
    api,
    store,
    ready: hydrated,
  } = createCredentialStore({
    store: options?.credentials?.store,
    hooks: options?.credentials?.hooks,
    driver,
    binding,
    log: provider.log,
    storageKey: options?.credentials?.storageKey,
  });

  const extension = {
    /** Reactive list of the credentials held by the wallet. */
    get credentials() {
      return store.state.credentials;
    },
    /** Reactive list of the mirrored OID4VCI issuance sessions. */
    get issuanceSessions() {
      return store.state.issuanceSessions;
    },
    /** Reactive list of the mirrored OID4VP verification sessions. */
    get verificationSessions() {
      return store.state.verificationSessions;
    },
    credential: {
      store: api,
      digital: webDigitalCredentials,
    },
  } as WebCredentialsExtension;

  // We need to provide a provider that includes the credential surface so
  // WithCredentialsConnections can reuse an already-mounted provider.credential.remote.
  const bridgeProvider = Object.create(provider, {
    credential: {
      value: extension.credential,
      enumerable: true,
    },
  });

  // Dynamic import to keep the bridge an optional peer (and out of bundles
  // that never connect); the mirror is attached once the module resolves.
  const loadBridge = async (): Promise<void> => {
    const { WithCredentialsConnections } =
      (await import("@algorandfoundation/credentials-connections-extension")) as {
        WithCredentialsConnections: typeof WithCredentialsConnectionsType;
      };
    const surface = WithCredentialsConnections(bridgeProvider, { credentials: { store } });
    if (!extension.credential.remote) {
      extension.credential.remote = surface.credential.remote;
    }
  };

  // Attach a no-op rejection handler so an unavailable bridge module (e.g.
  // peer not installed) does not surface as an unhandled promise rejection.
  const bridgeSettled = loadBridge().catch(() => {
    /* swallow: a missing bridge degrades to a local-only credentials surface */
  });

  // Attach onto the SHARED store API instance (the engine-resolved object)
  // so `provider.credential.store.ready` is visible to every consumer.
  extension.credential.store.ready = Promise.allSettled([hydrated, bridgeSettled]).then(() => {});

  return extension;
};
