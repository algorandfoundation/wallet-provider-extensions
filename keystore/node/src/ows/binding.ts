/**
 * @module ows/binding
 *
 * Access-profile selection for the OWS adapter.
 *
 * OWS deliberately exposes the same capabilities through several equivalent
 * access layers, and an implementation offering more than one MUST keep them
 * consistent. Callers therefore should not have to care which one is installed:
 * {@link resolveOwsBinding} prefers the in-process NAPI bindings and falls back
 * to the `ows` binary, and {@link createOwsBinding} wraps that choice in a
 * binding that can be handed to the engine before the decision is made.
 */

import { createOwsCliBinding } from "./cli.ts";
import { createOwsNativeBinding } from "./native.ts";
import type {
  OwsBinding,
  OwsBindingOptions,
  OwsCreateWalletRequest,
  OwsImportMnemonicRequest,
  OwsImportPrivateKeyRequest,
  OwsSignHashRequest,
  OwsSignMessageRequest,
  OwsSignResult,
  OwsSignTransactionRequest,
  OwsWalletInfo,
} from "./types.ts";
import { OwsUnsupportedOperationError } from "./errors.ts";

/**
 * Picks the best available OWS access profile.
 *
 * The in-process NAPI bindings are preferred — they are the fastest path and
 * keep the credential out of any process table — and the `ows` subprocess is
 * used when the native package is not installed (or has no prebuilt binary for
 * the host platform). An explicitly supplied `module`/`specifier` pins the
 * native profile and surfaces its load failure instead of falling back.
 *
 * @param options - {@link OwsBindingOptions}, forwarded to whichever profile wins.
 * @returns The resolved {@link OwsBinding}.
 *
 * @example
 * ```typescript
 * const binding = await resolveOwsBinding({ vaultPath: "/tmp/ows-vault" });
 * console.log(binding.kind); // => "native" | "cli"
 * ```
 */
export async function resolveOwsBinding(options: OwsBindingOptions = {}): Promise<OwsBinding> {
  const native = createOwsNativeBinding(options);
  if (options.module !== undefined || options.specifier !== undefined) {
    await native.ready;
    return native;
  }
  try {
    await native.ready;
    return native;
  } catch {
    return createOwsCliBinding(options);
  }
}

/**
 * Creates an {@link OwsBinding} that resolves its access profile lazily, on the
 * first call, via {@link resolveOwsBinding}.
 *
 * This is what {@link import("./engine.ts").createOwsKeyStore} uses when no
 * binding is injected, so building a keystore never blocks on probing for the
 * optional native package.
 *
 * @param options - {@link OwsBindingOptions}.
 * @returns A binding that delegates to the profile chosen on first use.
 *
 * @example
 * ```typescript
 * const keystore = createOwsKeyStore({ store, binding: createOwsBinding() });
 * ```
 */
export function createOwsBinding(options: OwsBindingOptions = {}): OwsBinding {
  let pending: Promise<OwsBinding> | undefined;
  const resolved = (): Promise<OwsBinding> => (pending ??= resolveOwsBinding(options));

  return {
    kind: "auto",
    get ready(): Promise<void> {
      return resolved().then(() => undefined);
    },
    async listWallets(): Promise<OwsWalletInfo[]> {
      return (await resolved()).listWallets();
    },
    async getWallet(nameOrId: string): Promise<OwsWalletInfo> {
      return (await resolved()).getWallet(nameOrId);
    },
    async createWallet(request: OwsCreateWalletRequest): Promise<OwsWalletInfo> {
      return (await resolved()).createWallet(request);
    },
    async importMnemonic(request: OwsImportMnemonicRequest): Promise<OwsWalletInfo> {
      return (await resolved()).importMnemonic(request);
    },
    async importPrivateKey(request: OwsImportPrivateKeyRequest): Promise<OwsWalletInfo> {
      return (await resolved()).importPrivateKey(request);
    },
    async deleteWallet(nameOrId: string): Promise<void> {
      await (await resolved()).deleteWallet(nameOrId);
    },
    async exportWallet(nameOrId: string, passphrase?: string): Promise<string> {
      return (await resolved()).exportWallet(nameOrId, passphrase);
    },
    async signMessage(request: OwsSignMessageRequest): Promise<OwsSignResult> {
      return (await resolved()).signMessage(request);
    },
    async signTransaction(request: OwsSignTransactionRequest): Promise<OwsSignResult> {
      return (await resolved()).signTransaction(request);
    },
    async signHash(request: OwsSignHashRequest): Promise<OwsSignResult> {
      const binding = await resolved();
      if (!binding.signHash) {
        throw new OwsUnsupportedOperationError(
          "signHash",
          `the ${binding.kind} access layer does not expose raw digest signing`,
        );
      }
      return binding.signHash(request);
    },
  };
}
