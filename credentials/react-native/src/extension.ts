import {
  createCredentialStore,
  identityHolderBinding,
  memoryCredentialDriver,
  type CredentialStoreApi,
  type CredentialStoreExtension,
  type CredentialStoreOptions,
  type DigitalCredentialsPlatform,
  type DigitalCredentialsProvider,
  type HolderIdentityStore,
} from "@algorandfoundation/credentials-core";
import type {
  RemoteCredentialsMirror,
  WithCredentialsConnections as WithCredentialsConnectionsType,
} from "@algorandfoundation/credentials-connections-extension";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { reactNativeDigitalCredentials } from "./platform.ts";
import {
  defaultDigitalCredentialsModule,
  nativeDigitalCredentialsProvider,
  unsupportedDigitalCredentialsProvider,
  type DigitalCredentialsModuleLike,
} from "./provider.ts";

declare module "@algorandfoundation/credentials-core" {
  /**
   * React Native additions to the shared `options.credentials` namespace: the
   * native Digital Credentials module seam the wallet/holder side binds to.
   * The reactive store, hooks, persistence driver, holder binding and storage
   * key come from the base {@link CredentialsNamespace}.
   */
  interface CredentialsNamespace {
    /**
     * The native Digital Credentials module; when omitted the extension
     * lazily resolves the expo native module bundled with this package
     * ({@link defaultDigitalCredentialsModule}) and falls back to an explicit
     * `unsupported` provider when that is unavailable.
     */
    digitalCredentialsModule?: DigitalCredentialsModuleLike;
  }
}

/**
 * React Native credentials extension options.
 *
 * The same {@link CredentialStoreOptions} shape; this package augments the
 * shared {@link CredentialsNamespace} with the `digitalCredentialsModule`
 * seam, so `options.credentials` accepts it alongside the base
 * `store`/`hooks`/`driver`/`binding`/`storageKey`.
 *
 * @example
 * ```typescript
 * const options: ReactNativeCredentialsOptions = {
 *   credentials: {
 *     driver: { get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) },
 *     digitalCredentialsModule: fakeNativeModule, // tests / custom bindings
 *   },
 * };
 * ```
 */
export type ReactNativeCredentialsOptions = CredentialStoreOptions;

/**
 * The extension surface contributed by the React Native credentials package:
 * the platform-neutral credential store plus the React Native
 * {@link DigitalCredentialsPlatform} at `provider.credential.digital` and the
 * wallet/holder {@link DigitalCredentialsProvider} at
 * `provider.credential.digitalProvider`.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithCredentials]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, {});
 * if (provider.credential.digitalProvider.isSupported()) {
 *   await provider.credential.digitalProvider.registerCredentials(entries);
 * }
 * ```
 */
export interface ReactNativeCredentialsExtension extends CredentialStoreExtension {
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
    digitalProvider: DigitalCredentialsProvider;
  };
}

/**
 * Wallet Provider Extension that adds React Native credentials functionality.
 *
 * A thin Provider/Extensions wrapper around the shared `createCredentialStore`
 * engine from `@algorandfoundation/credentials-core`, the same pattern every
 * keystore platform package follows with `WithKeyStore`/`createKeyStore`:
 *
 * - **Persistence** comes from `options.credentials.driver`: React Native
 *   has no universal storage primitive, so applications inject their own
 *   key/value adapter (MMKV, AsyncStorage, ... in two lines). Without one,
 *   an in-memory driver is used and nothing survives a restart.
 * - **Holder binding** comes from `options.credentials.binding` when
 *   injected, otherwise `identityHolderBinding(provider.identity.store)` is
 *   auto-wired when an identities extension is mounted. Without either, the
 *   store still mounts: `getSignerForIdentity` resolves `undefined` and no
 *   removal cascade is wired.
 * - The **requester** side of the Digital Credentials API is attached at
 *   `provider.credential.digital`, currently the
 *   {@link reactNativeDigitalCredentials} `unsupported` stub.
 * - The **wallet/holder** side is attached at
 *   `provider.credential.digitalProvider`, backed by the Digital
 *   Credentials expo native module this package ships (Android Credential
 *   Manager registry) when it is injected via
 *   `options.credentials.digitalCredentialsModule` or available in the
 *   host runtime; otherwise an explicit `unsupported` provider.
 * - The connections bridge
 *   (`@algorandfoundation/credentials-connections-extension`) is loaded
 *   lazily to mount the session-scoped remote mirror at
 *   `provider.credential.remote` over the engine-resolved store; a missing
 *   bridge peer degrades silently to a local-only credentials surface.
 *   `provider.credential.store.ready` resolves once the import settled.
 *
 * @param provider - The host provider (may carry `log` and `identity` extensions).
 * @param options - {@link ReactNativeCredentialsOptions}; every `options.credentials` member is optional.
 * @returns The {@link ReactNativeCredentialsExtension} surface.
 *
 * @example
 * ```typescript
 * import { Provider } from "@algorandfoundation/wallet-provider";
 * import { WithIdentities } from "@algorandfoundation/identities-core";
 * import { WithCredentials } from "@algorandfoundation/react-native-credentials";
 *
 * const MyProvider = Provider.withExtensions([WithIdentities, WithCredentials]);
 * const provider = new MyProvider(
 *   { id: "my-provider", name: "My Provider" },
 *   { credentials: { driver: { get: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v) } } },
 * );
 * await provider.credential.store.ready;
 * ```
 */
export const WithCredentials: Extension<ReactNativeCredentialsExtension> = (
  provider: Provider<any> &
    Partial<LogStoreExtension> & { identity?: { store?: HolderIdentityStore } },
  options: ReactNativeCredentialsOptions,
) => {
  const binding =
    options?.credentials?.binding ??
    (provider.identity?.store ? identityHolderBinding(provider.identity.store) : undefined);
  const driver = options?.credentials?.driver ?? memoryCredentialDriver();

  const digitalCredentialsModule =
    options?.credentials?.digitalCredentialsModule ?? defaultDigitalCredentialsModule();
  const digitalProvider = digitalCredentialsModule
    ? nativeDigitalCredentialsProvider(digitalCredentialsModule)
    : unsupportedDigitalCredentialsProvider(
        "the Digital Credentials native module is unavailable in this runtime",
      );

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
      digital: reactNativeDigitalCredentials,
      digitalProvider,
    },
  } as ReactNativeCredentialsExtension;

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
