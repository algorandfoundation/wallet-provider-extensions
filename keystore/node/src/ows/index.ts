/**
 * @module ows
 *
 * The [Open Wallet Standard](https://openwallet.sh/) adapter: a keystore whose
 * custodian is an OWS vault instead of the OS keychain.
 *
 * OWS ships a Rust core with a strong CLI, an agent-oriented policy engine and
 * API-token capabilities; this package keeps its own abstraction — the reactive
 * store, the extension surface and the `KeyStoreAPI` — and binds them to that
 * core, so a provider can drive OWS-custodied accounts with the exact same code
 * it uses for local keys.
 *
 * - {@link createOwsKeyStore} — the drop-in engine; plug it into any keystore
 *   extension via `options.api.keystore`.
 * - {@link WithOwsKeyStore} — the ready-made Wallet Provider extension.
 * - {@link createOwsNativeBinding} / {@link createOwsCliBinding} — the two OWS
 *   access profiles (in-process NAPI bindings, `ows` subprocess), selected
 *   automatically by {@link resolveOwsBinding}.
 */

export { createOwsBinding, resolveOwsBinding } from "./binding.ts";
export { CHAIN_FAMILIES, chainCurve, chainFamily, ED25519_FAMILIES } from "./chains.ts";
export {
  createOwsCliBinding,
  createOwsCliRunner,
  OWS_CLI_BIN,
  OWS_PASSPHRASE_ENV,
  OWS_VAULT_PATH_ENV,
} from "./cli.ts";
export { createOwsKeyStore } from "./engine.ts";
export {
  OWS_ERROR_CODES,
  OwsError,
  owsErrorCode,
  OwsUnsupportedOperationError,
  toKeyStoreError,
  type OwsErrorCode,
} from "./errors.ts";
export { WithOwsKeyStore } from "./extension.ts";
export { createOwsNativeBinding, OWS_NATIVE_MODULE } from "./native.ts";
export {
  OWS_KEY_PREFIX,
  parseKeyId,
  selectKey,
  setKeys,
  setStatus,
  toKey,
  toKeyId,
  toKeys,
  toSignResult,
  toWalletInfo,
} from "./store.ts";
export type {
  OwsAccount,
  OwsBinding,
  OwsBindingOptions,
  OwsChainFamily,
  OwsCliBindingOptions,
  OwsCliRunner,
  OwsContext,
  OwsCreateWalletRequest,
  OwsCurve,
  OwsImportMnemonicRequest,
  OwsImportPrivateKeyRequest,
  OwsKeyStore,
  OwsKeyStoreOptions,
  OwsKeystoreOptions,
  OwsNativeBindingOptions,
  OwsNativeModule,
  OwsSignHashRequest,
  OwsSignMessageRequest,
  OwsSignOperation,
  OwsSignRequestBase,
  OwsSignResult,
  OwsSignTransactionRequest,
  OwsWalletInfo,
} from "./types.ts";
