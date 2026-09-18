import { WithIdentities as WithIdentitiesCore } from "@algorandfoundation/identities-core";
import type {
  BaseIdentity,
  DIDDocument,
  Identity,
  IdentityStoreState,
} from "@algorandfoundation/identities-core";
import type { WithIdentitiesConnections as WithIdentitiesConnectionsType } from "@algorandfoundation/identities-connections-extension";
import type { WithIdentitiesKeystore as WithIdentitiesKeystoreType } from "@algorandfoundation/identities-keystore-extension";
import { Store } from "@tanstack/store";
import type { IdentitiesExtension, IdentitiesExtensionOptions } from "./types.ts";

/**
 * Unified extension that combines identity store, keystore bridge, and
 * connections bridge.
 *
 * This is the **composed** `WithIdentities`: the core store extension of the
 * same name (`@algorandfoundation/identities-core`, store only) plus the
 * bridges, mirroring the `accounts-core` / `accounts` pattern.
 *
 * It always provides the identity store, and if the keystore extension is present
 * on the provider, it also initializes the identities-keystore bridge. The
 * connections bridge (`@algorandfoundation/identities-connections-extension`)
 * is loaded lazily to mount the session-scoped remote mirror at
 * `provider.identity.remote`; a missing bridge peer degrades silently to a
 * local-only identities surface.
 *
 * `provider.identity.store.ready` resolves once **all** of this extension's
 * dynamic bridge imports have settled (keystore bridge when
 * `provider.key.store` is present, plus the connections bridge) — the
 * identities counterpart of the keystore's `provider.key.store.ready`.
 * Await it before initiating a connection to guarantee the mirror is
 * mounted.
 *
 * @template T - The identity type held by the store (defaults to the base
 * {@link Identity}); pin it with an instantiation expression
 * (`WithIdentities<MyIdentity>`) the same way the core extension is pinned.
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The unified identities extension.
 *
 * @example
 * ```typescript
 * import { Provider } from "@algorandfoundation/wallet-provider";
 * import { WithKeyStore } from "@algorandfoundation/keystore";
 * import { WithIdentities } from "@algorandfoundation/identities";
 *
 * const MyProvider = Provider.withExtensions([WithKeyStore, WithIdentities]);
 * const provider = new MyProvider(
 *   { id: "my-wallet", name: "My Wallet" },
 *   {
 *     keystore: { store: keyStore, hooks: keyHooks },
 *     identities: { store: identityStore },
 *   },
 * );
 * await provider.identity.store.ready;
 * ```
 */
export const WithIdentities = <T extends BaseIdentity = Identity>(
  provider: any,
  options?: IdentitiesExtensionOptions<T>,
): IdentitiesExtension<T> => {
  // Resolve (or create) the concrete identity store up front so the same
  // instance is shared with the dynamically loaded keystore bridge.
  const identitiesStore =
    options?.identities?.store ?? new Store<IdentityStoreState<T>>({ identities: [] });

  const resolvedOptions: IdentitiesExtensionOptions<T> = {
    ...options,
    identities: {
      ...options?.identities,
      store: identitiesStore,
    } as IdentitiesExtensionOptions<T>["identities"],
  };

  // Load the identity store (incrementally: reuses provider.identity?.store if present).
  const identityStore = WithIdentitiesCore<T>(provider, resolvedOptions as any);

  const api: any = {
    get identities() {
      return identityStore.identities;
    },
    identity: {
      ...identityStore.identity,
      // Reuse (rather than shallow-copy) the resolved identity store API so
      // any properties attached below also live on the shared instance and
      // are not lost if a downstream consumer reads the original reference.
      store: identityStore.identity.store,
    },
  };

  // We need to provide a provider that includes the identity store so the
  // bridges can find (and idempotently reuse) provider.identity members.
  const bridgeProvider = Object.create(provider, {
    identities: {
      get() {
        return identityStore.identities;
      },
      enumerable: true,
    },
    identity: {
      value: api.identity,
      enumerable: true,
    },
  });

  // The bridge settle promises `identity.store.ready` is built from; each
  // entry never rejects (rejections are swallowed where the promise is made).
  const bridgeSettles: Promise<unknown>[] = [];

  // Conditionally load the keystore bridge if keystore is available
  if (provider?.key?.store) {
    // Pass the concrete identities store/hooks into the bridge so it does not
    // throw at runtime when consumers wire WithKeyStore + WithIdentities
    // without explicitly providing `options.identities.store`.
    const bridgeOptions = resolvedOptions as any;

    // Dynamic import to support React Native and reduce bundle size
    const loadBridge = async () => {
      const { WithIdentitiesKeystore } =
        (await import("@algorandfoundation/identities-keystore-extension")) as {
          WithIdentitiesKeystore: typeof WithIdentitiesKeystoreType;
        };
      return WithIdentitiesKeystore(bridgeProvider, bridgeOptions);
    };

    // Trigger background loading for autoPopulate to work. Attach a no-op
    // rejection handler so an unavailable bridge module (e.g. peer not
    // installed) does not surface as an unhandled promise rejection.
    const bridgePromise = loadBridge();
    bridgeSettles.push(
      bridgePromise.catch(() => {
        /* swallow: surfaced lazily via restoreFromDidDocument below */
      }),
    );

    // Add lazy restoreFromDidDocument
    api.identity.store.restoreFromDidDocument = async (doc: DIDDocument) => {
      const bridgeContribution = await bridgePromise;
      return bridgeContribution.identity.store.restoreFromDidDocument(doc);
    };
  }

  // Dynamic import to keep the connections bridge an optional peer (and out
  // of bundles that never connect); the mirror is attached once it resolves.
  const loadConnectionsBridge = async (): Promise<void> => {
    const { WithIdentitiesConnections } =
      (await import("@algorandfoundation/identities-connections-extension")) as {
        WithIdentitiesConnections: typeof WithIdentitiesConnectionsType;
      };
    const surface = WithIdentitiesConnections<T>(bridgeProvider, resolvedOptions as any);
    if (!api.identity.remote) {
      api.identity.remote = surface.identity.remote;
    }
  };

  // Attach a no-op rejection handler so an unavailable bridge module (e.g.
  // peer not installed) does not surface as an unhandled promise rejection.
  bridgeSettles.push(
    loadConnectionsBridge().catch(() => {
      /* swallow: a missing bridge degrades to a local-only identities surface */
    }),
  );

  // Attach onto the SHARED store API instance (the same object the core
  // mounted — possibly reused from a prior extension) so
  // `provider.identity.store.ready` is visible to every consumer.
  api.identity.store.ready = Promise.allSettled(bridgeSettles).then(() => {});

  return api as IdentitiesExtension<T>;
};
