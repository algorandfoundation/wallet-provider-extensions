import {
  WithPasskeys as WithCorePasskeys,
  type Passkey,
  type PasskeysExtension,
  type PasskeysOptions,
  type PasskeysState,
} from "@algorandfoundation/passkeys-core";
import type {
  RemotePasskeysMirror,
  WithPasskeysConnections as WithPasskeysConnectionsType,
} from "@algorandfoundation/passkeys-connections-extension";
import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";

import { defaultPasskeyAutofillModule, nativePasskeysFeeder } from "./feeder.ts";
import type { PasskeyAutofillModuleLike } from "./feeder.ts";

declare module "@algorandfoundation/passkeys-core" {
  /**
   * React Native additions to the shared `options.passkeys` namespace: the
   * injectable native autofill `module` the {@link WithPasskeys} extension
   * feeds the store from. The reactive `store`, `hooks` and `log` come from
   * the base `PasskeysNamespace`.
   */
  interface PasskeysNamespace {
    /**
     * The native autofill module; when omitted the extension lazily
     * resolves `@algorandfoundation/react-native-passkey-autofill`.
     */
    module?: PasskeyAutofillModuleLike;
  }
}

/**
 * The extension surface contributed by the React Native passkeys
 * package: the platform-neutral {@link PasskeysExtension} of
 * `@algorandfoundation/passkeys-core`, plus the native-provider surface
 * (initial-sync `ready`, `refresh`, and the provider probes that live
 * on this platform package).
 *
 * @example
 * ```typescript
 * await provider.passkey.ready; // initial native sync
 * if (!(await provider.passkey.providerActive())) {
 *   await provider.passkey.openProviderSettings();
 * }
 * ```
 */
export interface ReactNativePasskeysExtension extends PasskeysExtension {
  passkey: PasskeysExtension["passkey"] & {
    store: PasskeysExtension["passkey"]["store"] & {
      /**
       * Resolves once this extension's dynamic bridge import has settled
       * (mounted, or swallowed when the connections peer is not
       * installed) — the passkeys counterpart of the keystore's
       * `KeyStore.ready`, and a **distinct contract** from
       * `passkey.ready` (the initial native sync). Never rejects. After
       * it resolves, `provider.passkey.remote` is present whenever
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
    /**
     * Resolves once the initial native sync completed (even on failure).
     * Distinct from `passkey.store.ready`, which tracks the connections
     * bridge import instead of the native module.
     */
    ready: Promise<void>;
    /** Re-syncs the native module's credentials into the store. */
    refresh(): Promise<Passkey[]>;
    /** Whether this app is the device's active credential provider. */
    providerActive(): Promise<boolean>;
    /** Opens the OS credential/autofill provider settings screen. */
    openProviderSettings(): Promise<boolean>;
  };
}

/**
 * Options accepted by {@link WithPasskeys} under the `passkeys` key.
 *
 * The same {@link PasskeysOptions} shape; this package augments the shared
 * `PasskeysNamespace` with the injectable native `module`, so
 * `options.passkeys` accepts it alongside the base `store`/`hooks`/`log`.
 *
 * @example
 * ```typescript
 * import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";
 *
 * const options: ReactNativePasskeysOptions = {
 *   passkeys: { store: passkeysStore, module: PasskeyAutofill },
 * };
 * ```
 */
export type ReactNativePasskeysOptions = PasskeysOptions;

/**
 * Wallet Provider Extension that adds React Native passkeys
 * functionality.
 *
 * Composes the core `WithPasskeys` of
 * `@algorandfoundation/passkeys-core` with the
 * {@link import("./feeder.ts").nativePasskeysFeeder} over
 * `options.passkeys.module` (or the lazily resolved
 * `@algorandfoundation/react-native-passkey-autofill` default export):
 * the feeder syncs the module's credentials into the passkeys store and
 * propagates store removals back to the module. The provider probes
 * (`providerActive`/`openProviderSettings`) are mounted on this
 * platform surface. Throws when no module is resolvable.
 *
 * The connections bridge
 * (`@algorandfoundation/passkeys-connections-extension`) is loaded
 * lazily to mount the session-scoped remote mirror at
 * `provider.passkey.remote`; a missing bridge peer degrades silently to
 * a local-only passkeys surface. `provider.passkey.store.ready` resolves
 * once that import settled — a distinct contract from `passkey.ready`,
 * which tracks the initial native sync.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link ReactNativePasskeysOptions}; `passkeys.module`
 *   is required unless the autofill peer is resolvable at runtime.
 * @returns The {@link ReactNativePasskeysExtension} surface.
 *
 * @example
 * ```typescript
 * import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";
 *
 * const MyProvider = Provider.withExtensions([WithPasskeys]);
 * const provider = new MyProvider(config, {
 *   passkeys: { module: PasskeyAutofill },
 * });
 * await provider.passkey.ready;
 * ```
 */
export const WithPasskeys: Extension<ReactNativePasskeysExtension> = (
  provider: Provider<any> & Partial<LogStoreExtension>,
  options?: ReactNativePasskeysOptions,
) => {
  const module = options?.passkeys?.module ?? defaultPasskeyAutofillModule();
  if (!module) {
    throw new Error(
      "no @algorandfoundation/react-native-passkey-autofill module is resolvable; " +
        "pass the native module via `passkeys.module`",
    );
  }
  const store: Store<PasskeysState> =
    options?.passkeys?.store ?? new Store<PasskeysState>({ passkeys: [] });
  const log = options?.passkeys?.log ?? provider.log;

  const core = WithCorePasskeys(provider, {
    passkeys: { store, hooks: options?.passkeys?.hooks, log },
  }) as PasskeysExtension;
  const feeder = nativePasskeysFeeder({ module, store, log });

  const api = {
    get passkeys() {
      return core.passkeys;
    },
    passkey: {
      ...core.passkey,
      ready: feeder.ready,
      refresh: feeder.refresh,
      providerActive: (): Promise<boolean> => module.isProviderActive(),
      openProviderSettings: (): Promise<boolean> => module.openProviderSettings(),
    },
  } as ReactNativePasskeysExtension;

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
    const surface = WithPasskeysConnections(bridgeProvider, { passkeys: { store } });
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
