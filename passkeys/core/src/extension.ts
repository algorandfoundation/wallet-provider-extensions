import type { LogStoreExtension } from "@algorandfoundation/logs";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

import { reconcilePasskeys } from "./reconcile.ts";
import type { ReconcileResult } from "./reconcile.ts";
import { addPasskey, clearPasskeys, getPasskey, getPasskeys, removePasskey } from "./store.ts";
import type {
  Passkey,
  PasskeysExtension,
  PasskeysOptions,
  PasskeysState,
  PasskeysStoreApi,
  WebAuthnRequestOptionsLike,
} from "./types.ts";

/**
 * Wallet Provider Extension that adds the platform-neutral passkeys
 * store.
 *
 * Mirrors the accounts-core pattern: the reactive TanStack store
 * (created when `options.passkeys.store` is omitted) is the single seam
 * feeders write through; the store API (with `before-after-hook` hooks)
 * is mounted at `provider.passkey.store`. Feeders, e.g. the keystore
 * bridge (`@algorandfoundation/passkeys-keystore-extension`) or the
 * native credential provider
 * (`@algorandfoundation/react-native-passkeys`), observe and write the
 * same store instance.
 *
 * The session-scoped remote mirror lives in
 * `@algorandfoundation/passkeys-connections-extension`
 * (`WithPasskeysConnections`), which mounts it at
 * `provider.passkey.remote` over the same shared store.
 *
 * @param provider - The provider instance being extended (may carry a
 *   `log` extension, and an already-mounted `passkey.store` which is
 *   reused so mounting is idempotent).
 * @param options - {@link PasskeysOptions}; every `options.passkeys`
 *   field is optional.
 * @returns The {@link PasskeysExtension} surface: the reactive `passkeys`
 *   getter and the `passkey.store` API.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithPasskeys]);
 * const provider = new MyProvider({ id: "my-wallet", name: "My Wallet" }, {
 *   passkeys: { store: passkeysStore },
 * });
 * await provider.passkey.store.addPasskey({ credentialId: "abc" });
 * const { strays } = await provider.passkey.store.reconcile(serverOptions);
 * ```
 */
export const WithPasskeys: Extension<PasskeysExtension> = (
  provider: Provider<any> & Partial<LogStoreExtension> & Partial<PasskeysExtension>,
  options?: PasskeysOptions,
) => {
  const store: Store<PasskeysState> =
    options?.passkeys?.store ?? new Store<PasskeysState>({ passkeys: [] });
  const hooks = options?.passkeys?.hooks ?? new Hook.Collection<any>();
  const log = options?.passkeys?.log ?? provider.log;

  const storeApi: PasskeysStoreApi = provider.passkey?.store || {
    async addPasskey(passkey: Passkey): Promise<Passkey> {
      return hooks("add", addPasskey, { store, passkey });
    },
    async removePasskey(credentialId: string): Promise<void> {
      return hooks("remove", removePasskey, { store, credentialId });
    },
    async getPasskey(credentialId: string): Promise<Passkey | undefined> {
      return hooks("get", getPasskey, { store, credentialId });
    },
    async getPasskeys(): Promise<Passkey[]> {
      return hooks("list", getPasskeys, { store });
    },
    async clear(): Promise<void> {
      return hooks("clear", clearPasskeys, { store });
    },
    async reconcile(requestOptions: WebAuthnRequestOptionsLike): Promise<ReconcileResult> {
      const result = reconcilePasskeys(store.state.passkeys, requestOptions);
      store.setState((state) => ({ ...state, passkeys: result.passkeys }));
      log?.info(
        `reconcile completed: known=${result.known.length}, strays=${result.strays.length}, missing=${result.missing.length}`,
        {},
        "PasskeysStore",
      );
      return result;
    },
    hooks,
  };

  return {
    /** Reactive list of the passkeys the store holds. */
    get passkeys() {
      return store.state.passkeys;
    },
    passkey: {
      store: storeApi,
    },
  } as PasskeysExtension;
};
