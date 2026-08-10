/**
 * @module ows/native
 *
 * The **in-process** OWS access profile: an {@link OwsBinding} backed by the
 * `@open-wallet-standard/core` NAPI bindings, where the OWS Rust core runs in
 * the caller's address space — no CLI, no daemon, no subprocess.
 *
 * The native package is an *optional* peer: it is imported dynamically, by
 * specifier, so this package builds and runs without it and only fails when a
 * caller actually asks for the native profile.
 */

import { OwsUnsupportedOperationError } from "./errors.ts";
import { toSignResult, toWalletInfo } from "./store.ts";
import type {
  OwsBinding,
  OwsCreateWalletRequest,
  OwsImportMnemonicRequest,
  OwsImportPrivateKeyRequest,
  OwsNativeBindingOptions,
  OwsNativeModule,
  OwsSignHashRequest,
  OwsSignMessageRequest,
  OwsSignResult,
  OwsSignTransactionRequest,
  OwsWalletInfo,
} from "./types.ts";

/** The npm package holding the OWS NAPI bindings. */
export const OWS_NATIVE_MODULE = "@open-wallet-standard/core";

/**
 * Creates an {@link OwsBinding} on the OWS NAPI bindings (access profile A:
 * in-process binding).
 *
 * The module is loaded lazily and exactly once; `binding.ready` resolves when
 * it is available and rejects — with the import failure as `cause` — when the
 * optional package is not installed for the current platform. Every call
 * threads {@link OwsNativeBindingOptions.vaultPath} through as the trailing
 * `vaultPath` argument, and the credential (owner passphrase or `ows_key_…`
 * token) is passed verbatim so OWS performs its own credential detection and
 * policy evaluation.
 *
 * @param options - {@link OwsNativeBindingOptions}.
 * @returns The in-process {@link OwsBinding}.
 *
 * @example
 * ```typescript
 * const binding = createOwsNativeBinding({ vaultPath: "/tmp/ows-vault" });
 * const wallets = await binding.listWallets();
 * ```
 */
export function createOwsNativeBinding(options: OwsNativeBindingOptions = {}): OwsBinding {
  const vault = options.vaultPath;
  const specifier = options.specifier ?? OWS_NATIVE_MODULE;

  let loaded: Promise<OwsNativeModule> | undefined;
  const load = (): Promise<OwsNativeModule> => {
    if (options.module) return Promise.resolve(options.module);
    loaded ??= (import(specifier) as Promise<Record<string, unknown>>).then(
      (module) => (module["default"] ?? module) as OwsNativeModule,
    );
    return loaded;
  };

  /** Invokes a native function, tolerating both sync and promise returns. */
  const call = async <T>(fn: (module: OwsNativeModule) => unknown): Promise<T> =>
    (await fn(await load())) as T;

  return {
    kind: "native",
    get ready(): Promise<void> {
      return load().then(() => undefined);
    },

    async listWallets(): Promise<OwsWalletInfo[]> {
      const wallets = await call<unknown>((m) => m.listWallets(vault));
      return (Array.isArray(wallets) ? wallets : []).map(toWalletInfo);
    },

    async getWallet(nameOrId: string): Promise<OwsWalletInfo> {
      return toWalletInfo(await call<unknown>((m) => m.getWallet(nameOrId, vault)));
    },

    async createWallet(request: OwsCreateWalletRequest): Promise<OwsWalletInfo> {
      return toWalletInfo(
        await call<unknown>((m) =>
          m.createWallet(request.name, request.passphrase, request.words, vault),
        ),
      );
    },

    async importMnemonic(request: OwsImportMnemonicRequest): Promise<OwsWalletInfo> {
      return toWalletInfo(
        await call<unknown>((m) =>
          m.importWalletMnemonic(
            request.name,
            request.mnemonic,
            request.passphrase,
            request.index,
            vault,
          ),
        ),
      );
    },

    async importPrivateKey(request: OwsImportPrivateKeyRequest): Promise<OwsWalletInfo> {
      return toWalletInfo(
        await call<unknown>((m) =>
          m.importWalletPrivateKey(
            request.name,
            request.privateKeyHex,
            request.passphrase,
            vault,
            request.chain,
          ),
        ),
      );
    },

    async deleteWallet(nameOrId: string): Promise<void> {
      await call<unknown>((m) => m.deleteWallet(nameOrId, vault));
    },

    async exportWallet(nameOrId: string, passphrase?: string): Promise<string> {
      return String(await call<unknown>((m) => m.exportWallet(nameOrId, passphrase, vault)));
    },

    async signMessage(request: OwsSignMessageRequest): Promise<OwsSignResult> {
      return toSignResult(
        await call<unknown>((m) =>
          m.signMessage(
            request.wallet,
            request.chain,
            request.message,
            request.passphrase,
            request.encoding,
            request.index,
            vault,
          ),
        ),
      );
    },

    async signTransaction(request: OwsSignTransactionRequest): Promise<OwsSignResult> {
      return toSignResult(
        await call<unknown>((m) =>
          m.signTransaction(
            request.wallet,
            request.chain,
            request.transactionHex,
            request.passphrase,
            request.index,
            vault,
          ),
        ),
      );
    },

    async signHash(request: OwsSignHashRequest): Promise<OwsSignResult> {
      const module = await load();
      if (!module.signHash) {
        throw new OwsUnsupportedOperationError("signHash", `${specifier} does not expose it`);
      }
      return toSignResult(
        await module.signHash(
          request.wallet,
          request.chain,
          request.hashHex,
          request.passphrase,
          request.index,
          vault,
        ),
      );
    },
  };
}
