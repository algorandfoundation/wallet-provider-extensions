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

import { localStorageCredentialDriver } from "./driver.ts";
import { webDigitalCredentials } from "./platform.ts";

/**
 * The extension surface contributed by the browser credentials package:
 * the platform-neutral credential store plus the browser
 * {@link DigitalCredentialsPlatform} at `provider.credential.digital`.
 */
export interface WebCredentialsExtension extends CredentialStoreExtension {
  credential: {
    store: CredentialStoreApi;
    digital: DigitalCredentialsPlatform;
  };
}

/**
 * Wallet Provider Extension that adds browser credentials functionality.
 *
 * A thin Provider/Extensions wrapper around the shared `createCredentialStore`
 * engine from `@algorandfoundation/credentials-core` — the same pattern every
 * keystore platform package follows with `WithKeyStore`/`createKeyStore`:
 *
 * - **Persistence** comes from `options.credentials.driver` when injected,
 *   otherwise the browser default ({@link localStorageCredentialDriver}); a
 *   memory driver is the last resort when `localStorage` is unavailable.
 * - **Holder binding** comes from `options.credentials.binding` when
 *   injected, otherwise `identityHolderBinding(provider.identity.store)` is
 *   auto-wired when an identities extension is mounted. Without either, the
 *   store still mounts — `getSignerForIdentity` resolves `undefined` and no
 *   removal cascade is wired.
 * - The browser Digital Credentials implementation is attached at
 *   `provider.credential.digital` — currently the
 *   {@link webDigitalCredentials} `unsupported` stub.
 */
export const WithCredentials: Extension<WebCredentialsExtension> = (
  provider: Provider<any> &
    Partial<LogStoreExtension> & { identity?: { store?: HolderIdentityStore } },
  options: CredentialStoreOptions,
) => {
  const binding =
    options?.credentials?.binding ??
    (provider.identity?.store ? identityHolderBinding(provider.identity.store) : undefined);
  const driver =
    options?.credentials?.driver ??
    (typeof globalThis.localStorage === "undefined"
      ? memoryCredentialDriver()
      : localStorageCredentialDriver());

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
      digital: webDigitalCredentials,
    },
  } as WebCredentialsExtension;
};
