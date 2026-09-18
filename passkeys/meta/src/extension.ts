import type { WithPasskeysConnections as WithPasskeysConnectionsType } from "@algorandfoundation/passkeys-connections-extension";
import { WithPasskeys as WithPasskeysCore } from "@algorandfoundation/passkeys-core";
import type { PasskeysExtension, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import type { PasskeysMetaExtension, PasskeysMetaOptions } from "./types.ts";

/**
 * Unified extension that combines the passkeys store and the connections
 * bridge.
 *
 * It always provides the passkeys store (`@algorandfoundation/passkeys-core`'s
 * `WithPasskeys`), and lazily loads the connections bridge
 * (`@algorandfoundation/passkeys-connections-extension`) to mount the
 * session-scoped remote mirror at `provider.passkey.remote`, so connection
 * engines can discover the passkeys domain. A missing bridge peer degrades
 * silently to a local-only passkeys surface.
 *
 * `provider.passkey.store.ready` resolves once the bridge import settled
 * (mounted, or swallowed when the peer is not installed) — the passkeys
 * counterpart of the keystore's `provider.key.store.ready`. Await it before
 * initiating a connection to guarantee the mirror is mounted.
 *
 * @param provider - The provider instance being extended (an
 *   already-mounted `passkey.store` is reused so mounting is idempotent).
 * @param options - {@link PasskeysMetaOptions}; every `options.passkeys`
 *   field is optional.
 * @returns The unified {@link PasskeysMetaExtension}.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithPasskeys]);
 * const provider = new MyProvider(config, { passkeys: { store: passkeysStore } });
 * await provider.passkey.store.ready; // connections bridge settled
 * provider.passkey.remote?.expose();
 * ```
 */
export const WithPasskeys = (
  provider: Provider<any> & Partial<PasskeysExtension>,
  options?: PasskeysMetaOptions,
): PasskeysMetaExtension => {
  // Resolve (or create) the concrete passkeys store up front so the same
  // instance is shared with the dynamically loaded connections bridge.
  const passkeysStore: Store<PasskeysState> =
    options?.passkeys?.store ?? new Store<PasskeysState>({ passkeys: [] });

  const resolvedOptions: PasskeysMetaOptions = {
    ...options,
    passkeys: {
      ...options?.passkeys,
      store: passkeysStore,
    },
  };

  // Load the passkeys store (incrementally: reuses provider.passkey?.store if present).
  const core = WithPasskeysCore(provider, resolvedOptions);

  const api = {
    get passkeys() {
      return core.passkeys;
    },
    // Reuse (rather than shallow-copy) the core namespace object so the
    // remote mirror attached below also lives on the shared instance and
    // is not lost if a downstream consumer reads the original reference.
    passkey: core.passkey,
  } as PasskeysMetaExtension;

  // We need to provide a provider that includes the passkeys store so that
  // WithPasskeysConnections can reuse an already-mounted provider.passkey.remote.
  const bridgeProvider = Object.create(provider, {
    passkeys: {
      get() {
        return core.passkeys;
      },
      enumerable: true,
    },
    passkey: {
      value: api.passkey,
      enumerable: true,
    },
  });

  // Dynamic import to keep the bridge an optional peer (and out of bundles
  // that never connect); the mirror is attached once the module resolves.
  const loadBridge = async (): Promise<void> => {
    const { WithPasskeysConnections } =
      (await import("@algorandfoundation/passkeys-connections-extension")) as {
        WithPasskeysConnections: typeof WithPasskeysConnectionsType;
      };
    const surface = WithPasskeysConnections(bridgeProvider, resolvedOptions);
    if (!api.passkey.remote) {
      api.passkey.remote = surface.passkey.remote;
    }
  };

  // Attach a no-op rejection handler so an unavailable bridge module (e.g.
  // peer not installed) does not surface as an unhandled promise rejection.
  const bridgeSettled = loadBridge().catch(() => {
    /* swallow: a missing bridge degrades to a local-only passkeys surface */
  });

  // Attach onto the SHARED store API instance (the same object the core
  // mounted — possibly reused from a prior extension) so
  // `provider.passkey.store.ready` is visible to every consumer.
  api.passkey.store.ready = bridgeSettled;

  return api;
};
