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
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { reactNativeDigitalCredentials } from "./platform.ts";

/**
 * The extension surface contributed by the React Native credentials package:
 * the platform-neutral credential store plus the React Native
 * {@link DigitalCredentialsPlatform} at `provider.credential.digital`.
 */
export interface ReactNativeCredentialsExtension extends CredentialStoreExtension {
  credential: {
    store: CredentialStoreApi;
    digital: DigitalCredentialsPlatform;
  };
}

/**
 * Wallet Provider Extension that adds React Native credentials functionality.
 *
 * A thin Provider/Extensions wrapper around the shared `createCredentialStore`
 * engine from `@algorandfoundation/credentials-core` — the same pattern every
 * keystore platform package follows with `WithKeyStore`/`createKeyStore`:
 *
 * - **Persistence** comes from `options.credentials.driver` — React Native
 *   has no universal storage primitive, so applications inject their own
 *   key/value adapter (MMKV, AsyncStorage, ... in two lines). Without one,
 *   an in-memory driver is used and nothing survives a restart.
 * - **Holder binding** comes from `options.credentials.binding` when
 *   injected, otherwise `identityHolderBinding(provider.identity.store)` is
 *   auto-wired when an identities extension is mounted. Without either, the
 *   store still mounts — `getSignerForIdentity` resolves `undefined` and no
 *   removal cascade is wired.
 * - The React Native Digital Credentials implementation is attached at
 *   `provider.credential.digital` — currently the
 *   {@link reactNativeDigitalCredentials} `unsupported` stub.
 */
export const WithCredentials: Extension<ReactNativeCredentialsExtension> = (
  provider: Provider<any> &
    Partial<LogStoreExtension> & { identity?: { store?: HolderIdentityStore } },
  options: CredentialStoreOptions,
) => {
  const binding =
    options?.credentials?.binding ??
    (provider.identity?.store ? identityHolderBinding(provider.identity.store) : undefined);
  const driver = options?.credentials?.driver ?? memoryCredentialDriver();

  const { api, store } = createCredentialStore({
    store: options?.credentials?.store,
    hooks: options?.credentials?.hooks,
    driver,
    binding,
    log: provider.log,
    storageKey: options?.credentials?.storageKey,
  });

  return {
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
    },
  } as ReactNativeCredentialsExtension;
};
