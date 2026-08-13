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

import { nodeDigitalCredentials } from "./platform.ts";

/**
 * The extension surface contributed by the node credentials entry: the
 * platform-neutral credential store plus the node
 * {@link DigitalCredentialsPlatform} at `provider.credential.digital`.
 */
export interface NodeCredentialsExtension extends CredentialStoreExtension {
  credential: {
    store: CredentialStoreApi;
    digital: DigitalCredentialsPlatform;
  };
}

/**
 * Wallet Provider Extension that adds credentials functionality on node.
 *
 * A thin Provider/Extensions wrapper around the shared `createCredentialStore`
 * engine from `@algorandfoundation/credentials-core` — the same pattern every
 * keystore platform package follows with `WithKeyStore`/`createKeyStore`:
 *
 * - **Persistence** comes from `options.credentials.driver` (any string
 *   key/value store adapts in two lines); without one an in-memory driver is
 *   used and nothing survives a restart.
 * - **Holder binding** comes from `options.credentials.binding` when
 *   injected, otherwise `identityHolderBinding(provider.identity.store)` is
 *   auto-wired when an identities extension is mounted. Without either, the
 *   store still mounts — `getSignerForIdentity` resolves `undefined` and no
 *   removal cascade is wired.
 * - The node Digital Credentials implementation is attached at
 *   `provider.credential.digital` — the permanent
 *   {@link nodeDigitalCredentials} `unsupported` stub (node has no
 *   user-agent credential chooser).
 */
export const WithCredentials: Extension<NodeCredentialsExtension> = (
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
      digital: nodeDigitalCredentials,
    },
  } as NodeCredentialsExtension;
};
