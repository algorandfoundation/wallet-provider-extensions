/**
 * @module ows/types
 *
 * The types of the Open Wallet Standard (OWS) adapter: the {@link OwsBinding}
 * seam every access profile implements, the OWS-shaped records that cross it,
 * and the options of the {@link import("./engine.ts").createOwsKeyStore} engine.
 *
 * @see {@link https://openwallet.sh/ Open Wallet Standard}
 */

import type {
  Key,
  KeyStore,
  KeyStoreOptions,
  KeyStoreState,
} from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * An OWS chain family — the coarse identifier the OWS surfaces accept wherever
 * a `chain` argument is expected (`"evm"`, `"solana"`, `"bitcoin"`, …). A
 * CAIP-2 chain id (`"eip155:8453"`) or a chain alias (`"base"`) is equally
 * accepted by OWS, so the type stays open.
 */
export type OwsChainFamily = string;

/** The signature curve backing an OWS account. */
export type OwsCurve = "secp256k1" | "ed25519";

/** A single chain account of an OWS wallet. */
export interface OwsAccount {
  /** CAIP-2 chain id, e.g. `"eip155:1"`. */
  chainId: string;
  /** The chain-native address. */
  address: string;
  /** The BIP-44 derivation path, e.g. `"m/44'/60'/0'/0/0"`. */
  derivationPath: string;
}

/** An OWS wallet descriptor: one seed, one account per supported chain. */
export interface OwsWalletInfo {
  /** UUID v4 of the wallet. */
  id: string;
  /** Human-readable wallet name (usable in place of the id on every surface). */
  name: string;
  /** The derived per-chain accounts. */
  accounts: OwsAccount[];
  /** ISO-8601 creation timestamp, when the surface reports one. */
  createdAt?: string;
}

/** The result of any OWS signing operation. */
export interface OwsSignResult {
  /** Hex-encoded signature (with or without a `0x` prefix). */
  signature: string;
  /** secp256k1 recovery id / `v` value, when the chain defines one. */
  recoveryId?: number;
}

/**
 * Which OWS signing operation {@link import("../../index.ts").KeyStore.sign}
 * maps to. Selected per call through {@link OwsContext.operation} (or the
 * `algorithm` argument of `sign`), defaulting to `"message"`.
 */
export type OwsSignOperation = "message" | "transaction" | "hash";

/**
 * The per-operation context of the OWS keystore.
 *
 * OWS authenticates every material-touching call with a credential and never
 * caches it, so the credential is threaded per operation exactly like the
 * biometric prompt of the React Native backend. The credential is either the
 * wallet owner's passphrase or an agent API token (`ows_key_…`); OWS itself
 * performs the credential-type detection and the policy evaluation, so the
 * adapter passes the value through verbatim.
 */
export interface OwsContext {
  /** Owner passphrase or `ows_key_…` API token. Overrides the engine default. */
  passphrase?: string;
  /** Which OWS signing operation to invoke. Defaults to `"message"`. */
  operation?: OwsSignOperation;
  /** Message encoding for `"message"` signing. Defaults to `"hex"`. */
  encoding?: "utf8" | "hex";
  /** Account index within the wallet. Defaults to `0`. */
  index?: number;
}

/** Request for {@link OwsBinding.createWallet}. */
export interface OwsCreateWalletRequest {
  /** Wallet name. */
  name: string;
  /** Optional encryption passphrase. */
  passphrase?: string;
  /** Mnemonic word count (12 or 24). */
  words?: number;
}

/** Request for {@link OwsBinding.importMnemonic}. */
export interface OwsImportMnemonicRequest {
  /** Wallet name. */
  name: string;
  /** The BIP-39 mnemonic phrase. */
  mnemonic: string;
  /** Optional encryption passphrase. */
  passphrase?: string;
  /** Account index for HD derivation. */
  index?: number;
}

/** Request for {@link OwsBinding.importPrivateKey}. */
export interface OwsImportPrivateKeyRequest {
  /** Wallet name. */
  name: string;
  /** Hex-encoded private key (with or without a `0x` prefix). */
  privateKeyHex: string;
  /** Optional encryption passphrase. */
  passphrase?: string;
  /** Source chain, which determines the curve. Defaults to `"evm"`. */
  chain?: OwsChainFamily;
}

/** The fields every OWS signing request carries. */
export interface OwsSignRequestBase {
  /** Wallet name or id. */
  wallet: string;
  /** Chain family, CAIP-2 id or alias. */
  chain: OwsChainFamily;
  /** Owner passphrase or `ows_key_…` API token. */
  passphrase?: string;
  /** Account index within the wallet. */
  index?: number;
}

/** Request for {@link OwsBinding.signMessage}. */
export interface OwsSignMessageRequest extends OwsSignRequestBase {
  /** The message to sign, in {@link OwsSignMessageRequest.encoding}. */
  message: string;
  /** Encoding of `message`. Defaults to `"utf8"` on the OWS side. */
  encoding?: "utf8" | "hex";
}

/** Request for {@link OwsBinding.signTransaction}. */
export interface OwsSignTransactionRequest extends OwsSignRequestBase {
  /** Hex-encoded serialized transaction bytes. */
  transactionHex: string;
}

/** Request for {@link OwsBinding.signHash}. */
export interface OwsSignHashRequest extends OwsSignRequestBase {
  /** Hex-encoded 32-byte digest. */
  hashHex: string;
}

/**
 * The seam between the keystore engine and a concrete OWS access layer.
 *
 * OWS defines several equivalent access profiles — in-process bindings, a local
 * subprocess and a local service — that MUST preserve the same core semantics.
 * The engine therefore talks to this narrow, profile-agnostic contract, and the
 * package ships two implementations of it:
 * {@link import("./native.ts").createOwsNativeBinding} (the NAPI bindings) and
 * {@link import("./cli.ts").createOwsCliBinding} (the `ows` binary).
 *
 * Every method maps 1:1 onto an OWS abstract operation, so no adapter is ever
 * allowed to weaken policy enforcement: credentials are passed through and
 * errors are surfaced, never rewritten into a success.
 */
export interface OwsBinding {
  /** Identifies the access profile (e.g. `"native"`, `"cli"`), for diagnostics. */
  readonly kind: string;
  /** Resolves once the binding can serve requests (e.g. its module is loaded). */
  readonly ready?: Promise<void>;
  /** Lists every wallet in the vault. */
  listWallets(): Promise<OwsWalletInfo[]>;
  /** Looks a wallet up by name or id. */
  getWallet(nameOrId: string): Promise<OwsWalletInfo>;
  /** Creates a wallet from a freshly generated mnemonic. */
  createWallet(request: OwsCreateWalletRequest): Promise<OwsWalletInfo>;
  /** Imports a wallet from a BIP-39 mnemonic. */
  importMnemonic(request: OwsImportMnemonicRequest): Promise<OwsWalletInfo>;
  /** Imports a wallet from a raw private key. */
  importPrivateKey(request: OwsImportPrivateKeyRequest): Promise<OwsWalletInfo>;
  /** Deletes a wallet and every account derived from it. */
  deleteWallet(nameOrId: string): Promise<void>;
  /**
   * Exports the wallet secret: the mnemonic phrase, or a JSON document holding
   * one private key per curve. This is the one OWS operation that reveals
   * secret material, so the engine gates it behind
   * {@link OwsKeyStoreOptions.allowExport}.
   */
  exportWallet(nameOrId: string, passphrase?: string): Promise<string>;
  /** Signs a message with the chain's message-signing convention. */
  signMessage(request: OwsSignMessageRequest): Promise<OwsSignResult>;
  /** Signs already-serialized transaction bytes. */
  signTransaction(request: OwsSignTransactionRequest): Promise<OwsSignResult>;
  /** Signs a raw 32-byte digest. Optional: not every surface exposes it. */
  signHash?(request: OwsSignHashRequest): Promise<OwsSignResult>;
}

/**
 * The subset of the OWS NAPI module (`@open-wallet-standard/core`) the native
 * binding calls. Declared structurally so the optional native package is never
 * a build-time dependency of this one, and so tests can inject a fake module.
 *
 * Every function mirrors the published signature, including the trailing
 * `vaultPath` argument, and may return its value synchronously (as the NAPI
 * bindings do) or as a promise.
 */
export interface OwsNativeModule {
  /** `listWallets(vaultPath?)` */
  listWallets(vaultPath?: string): unknown;
  /** `getWallet(nameOrId, vaultPath?)` */
  getWallet(nameOrId: string, vaultPath?: string): unknown;
  /** `createWallet(name, passphrase?, words?, vaultPath?)` */
  createWallet(name: string, passphrase?: string, words?: number, vaultPath?: string): unknown;
  /** `importWalletMnemonic(name, mnemonic, passphrase?, index?, vaultPath?)` */
  importWalletMnemonic(
    name: string,
    mnemonic: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ): unknown;
  /** `importWalletPrivateKey(name, privateKeyHex, passphrase?, vaultPath?, chain?)` */
  importWalletPrivateKey(
    name: string,
    privateKeyHex: string,
    passphrase?: string,
    vaultPath?: string,
    chain?: string,
  ): unknown;
  /** `deleteWallet(nameOrId, vaultPath?)` */
  deleteWallet(nameOrId: string, vaultPath?: string): unknown;
  /** `exportWallet(nameOrId, passphrase?, vaultPath?)` */
  exportWallet(nameOrId: string, passphrase?: string, vaultPath?: string): unknown;
  /** `signMessage(wallet, chain, message, passphrase?, encoding?, index?, vaultPath?)` */
  signMessage(
    wallet: string,
    chain: string,
    message: string,
    passphrase?: string,
    encoding?: string,
    index?: number,
    vaultPath?: string,
  ): unknown;
  /** `signTransaction(wallet, chain, txHex, passphrase?, index?, vaultPath?)` */
  signTransaction(
    wallet: string,
    chain: string,
    txHex: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ): unknown;
  /** `signHash(wallet, chain, hashHex, passphrase?, index?, vaultPath?)` */
  signHash?(
    wallet: string,
    chain: string,
    hashHex: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ): unknown;
}

/** Options for {@link import("./native.ts").createOwsNativeBinding}. */
export interface OwsNativeBindingOptions {
  /** A pre-loaded (or fake) native module. Skips the dynamic import entirely. */
  module?: OwsNativeModule;
  /** Module specifier to import. Defaults to `"@open-wallet-standard/core"`. */
  specifier?: string;
  /** Vault root threaded into every call. Defaults to OWS's own `~/.ows`. */
  vaultPath?: string;
}

/**
 * Runs the `ows` binary and resolves with its stdout.
 *
 * Injectable so {@link import("./cli.ts").createOwsCliBinding} can be exercised
 * without a real OWS installation.
 */
export type OwsCliRunner = (
  args: string[],
  options: { input?: string; env?: Record<string, string | undefined> },
) => Promise<string>;

/** Options for {@link import("./cli.ts").createOwsCliBinding}. */
export interface OwsCliBindingOptions {
  /** Path of the `ows` binary. Defaults to `"ows"` (resolved on `PATH`). */
  bin?: string;
  /** Vault root, exported to the CLI as `OWS_VAULT_PATH`. */
  vaultPath?: string;
  /** Extra environment for the child process. */
  env?: Record<string, string | undefined>;
  /** Process runner seam; defaults to spawning {@link OwsCliBindingOptions.bin}. */
  run?: OwsCliRunner;
}

/** Options for {@link import("./binding.ts").resolveOwsBinding}. */
export interface OwsBindingOptions extends OwsNativeBindingOptions, OwsCliBindingOptions {}

/** Options for {@link import("./engine.ts").createOwsKeyStore}. */
export interface OwsKeyStoreOptions {
  /** Reactive store mirroring the OWS accounts as UI-safe {@link Key} metadata. */
  store: Store<KeyStoreState>;
  /**
   * The OWS access layer to talk to. Defaults to
   * {@link import("./binding.ts").resolveOwsBinding}, which prefers the NAPI
   * bindings and falls back to the `ows` binary.
   */
  binding?: OwsBinding;
  /** Vault root passed to the default binding. Defaults to `~/.ows`. */
  vaultPath?: string;
  /**
   * Default credential (owner passphrase or `ows_key_…` API token) used when a
   * call does not carry one in its {@link OwsContext}.
   */
  passphrase?: string;
  /**
   * Allows {@link import("@algorandfoundation/keystore-core").KeyStoreAPI.export}
   * to reveal the OWS wallet secret. Disabled by default: OWS access layers
   * MUST NOT hand out decrypted material unless an export is explicitly asked
   * for, so opting in is a deliberate act.
   */
  allowExport?: boolean;
  /** Name given to wallets created through `generate`/`import`. */
  walletName?: string;
  /**
   * Optional hook collection bound at creation; every operation becomes
   * interceptable and the collection is exposed as `keystore.hooks`.
   */
  hooks?: HookCollection<any>;
}

/**
 * The OWS keystore: the shared {@link KeyStore} contract fulfilled by an OWS
 * vault, plus a {@link OwsKeyStore.refresh} to re-read the vault.
 *
 * Its per-operation context is an {@link OwsContext} carrying the OWS
 * credential, because OWS authenticates every call rather than holding an
 * unlocked session.
 */
export type OwsKeyStore = KeyStore<OwsContext> & {
  /** The access layer this keystore is bound to. */
  readonly binding: Promise<OwsBinding>;
  /** Re-reads the vault and re-hydrates the reactive store. */
  refresh(): Promise<Key[]>;
};

/**
 * Options of the {@link import("./extension.ts").WithOwsKeyStore} extension:
 * the base keystore block plus the OWS seams.
 */
export interface OwsKeystoreOptions extends KeyStoreOptions {
  keystore: KeyStoreOptions["keystore"] & {
    /** The OWS access layer; defaults to the resolved default binding. */
    binding?: OwsBinding;
    /** Vault root passed to the default binding. Defaults to `~/.ows`. */
    vaultPath?: string;
    /** Default owner passphrase / `ows_key_…` API token. */
    passphrase?: string;
    /** Allows `export` to reveal the OWS wallet secret. Off by default. */
    allowExport?: boolean;
    /** Name given to wallets created through `generate`/`import`. */
    walletName?: string;
  };
}
