/**
 * @module ows/extension
 *
 * The Wallet Provider extension that binds a provider to an OWS vault.
 *
 * It mirrors {@link import("../extension.ts").WithKeyStore} exactly — same
 * `keys`/`status`/`algorithms` getters, same `key.store` API — so swapping a
 * local OS-keychain keystore for an OWS-custodied one is a change of extension,
 * not of application code.
 */

import { createKeyStoreExtension, type KeyStoreExtension } from "@algorandfoundation/keystore-core";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";

import { createOwsKeyStore } from "./engine.ts";
import type { OwsKeystoreOptions } from "./types.ts";

/**
 * Wallet Provider Extension that adds an OWS-backed keystore.
 *
 * As with the node extension there is a single code path to the API: an
 * injected `options.api.keystore` is used as-is, otherwise the extension builds
 * the {@link createOwsKeyStore} engine from the `options.keystore` block (the
 * reactive `store` and `hooks`, plus the OWS seams — `binding`, `vaultPath`,
 * `passphrase`, `allowExport`, `walletName`).
 *
 * It answers at `provider.key.store` unless `options.keystore.mount` names
 * another path — `"ows"` for `provider.key.ows`, or `"rpc.ows"` for a named
 * service beside a local `provider.key.store`.
 *
 * @param provider - The host provider (may carry a `log` extension).
 * @param options - {@link OwsKeystoreOptions}. `options.keystore.store` and
 *   `options.keystore.hooks` are required.
 * @returns The {@link KeyStoreExtension} surface, served by the OWS vault.
 *
 * @example
 * ```typescript
 * const ProviderWithOws = Provider.withExtensions([WithOwsKeyStore]);
 * const provider = new ProviderWithOws(
 *   { id: "agent", name: "Agent" },
 *   { keystore: { store, hooks, passphrase: process.env.OWS_TOKEN } },
 * );
 *
 * await provider.key.store.ready;
 * const [account] = provider.keys;
 * await provider.key.store.sign(account.id, txBytes, "transaction");
 * ```
 */
export const WithOwsKeyStore: Extension<KeyStoreExtension> = (
  provider: Provider<any> & Partial<LogStoreExtension>,
  options: OwsKeystoreOptions,
) => {
  const keyStore = options.keystore.store;

  const keystore =
    options?.api?.keystore ??
    createOwsKeyStore({
      store: keyStore,
      ...(options.keystore.binding === undefined ? {} : { binding: options.keystore.binding }),
      ...(options.keystore.vaultPath === undefined
        ? {}
        : { vaultPath: options.keystore.vaultPath }),
      ...(options.keystore.passphrase === undefined
        ? {}
        : { passphrase: options.keystore.passphrase }),
      ...(options.keystore.allowExport === undefined
        ? {}
        : { allowExport: options.keystore.allowExport }),
      ...(options.keystore.walletName === undefined
        ? {}
        : { walletName: options.keystore.walletName }),
      ...(options.keystore.hooks === undefined ? {} : { hooks: options.keystore.hooks }),
    });

  // Mounted like any other keystore, so an OWS vault can sit next to a local
  // one on the same provider (e.g. `mount: "ows"`).
  return createKeyStoreExtension({
    provider,
    store: keyStore,
    keystore,
    ...(options.keystore.mount === undefined ? {} : { mount: options.keystore.mount }),
  }) as KeyStoreExtension;
};
