import type { Key, KeyId, KeyStoreOptions } from "@algorandfoundation/keystore-core";

import type { KeychainStorage } from "./storage/driver.ts";

/**
 * React Native keystore extension options.
 *
 * Extends the base {@link KeyStoreOptions} `keystore` block with the pieces the
 * {@link createReactNativeKeyStore} engine needs, following the
 * Provider/Extensions pattern: the reactive state store, hooks, host `subtle`
 * and composable `shims` come from the base options, while the mobile-specific
 * `authentication` policy and optional MMKV `storage` instance are injected
 * here.
 *
 * On React Native there is no reliable global Subtle, so pass
 * `react-native-quick-crypto`'s `subtle` via `keystore.subtle`. When `shims`
 * are omitted the engine enables the full default set.
 */
export interface ReactKeystoreOptions extends KeyStoreOptions {
  keystore: KeyStoreOptions["keystore"] & {
    /** Default authentication policy applied to every material-touching op. */
    authentication?: AuthenticationOptions;
    /** MMKV-style store for sealed material + metadata; defaults to the shared instance. */
    storage?: KeychainStorage;
  };
}

/**
 * The context this package's data migrations run against (see `./migrations`).
 *
 * Built by `WithKeyStore` when it registers the module with a provider's
 * `migrations` extension, and resolved by the runner **lazily** — only when at
 * least one revision is actually pending — so constructing it must stay cheap
 * and side-effect-free. Revision `0001` only touches `storage`; revision
 * `0002` additionally opens and re-seals material, which is why the host
 * `subtle` and the master-key read are part of the context rather than being
 * imported concretely by the revision files.
 */
export interface KeystoreMigrationContext {
  /** The MMKV-style store holding this keystore's records. */
  storage: KeychainStorage;
  /** Host Subtle implementation used to open/re-seal material. */
  subtle: SubtleCrypto;
  /**
   * Resolves the existing master key for a **read**. Must not create one — a
   * missing master key is how a fresh install (nothing to migrate) looks.
   */
  masterKeyForRead: (options?: AuthenticationOptions) => Promise<Uint8Array>;
  /** Authentication policy forwarded to {@link KeystoreMigrationContext.masterKeyForRead}. */
  authentication?: AuthenticationOptions;
}

/**
 * The material-touching keystore operations that can carry their own
 * authentication prompt wording (via {@link AuthenticationOptions.prompts} /
 * {@link AuthenticationOptions.resolvePrompt}). Mirrors `KeyStoreAPI` in
 * `keystore/core/src/types/backend.ts`, with `secrets.put/get/remove`
 * flattened to dotted names; `verify` is intentionally excluded because it
 * only touches the public key and never unlocks the master key.
 */
export type AuthenticationOperation =
  | "generate"
  | "import"
  | "importSeed"
  | "export"
  | "sign"
  | "batchSign"
  | "deriveFromSeed"
  | "deriveDomainKey"
  | "deriveSharedSecret"
  | "encryptWithKey"
  | "decryptWithKey"
  | "remove"
  | "clear"
  | "secret.put"
  | "secret.get"
  | "secret.remove";

/**
 * Options for the authentication prompt shown to the user. Matches
 * `react-native-keychain`'s `AuthenticationPrompt` shape, kept as a local
 * named type so it can be exported/reused without depending on that
 * package's types from our own public surface.
 */
export type AuthenticationPrompt = {
  /** The title for the authentication prompt. */
  title?: string;
  /** The subtitle for the authentication prompt (Android only). */
  subtitle?: string;
  /** The description for the authentication prompt (Android only). */
  description?: string;
  /** The cancel button text for the authentication prompt (Android only). */
  cancel?: string;
};

export type AuthenticationOptions = {
  biometrics?: boolean;

  /**
   * Opts the master-key Keychain item into the **strict** biometric policy
   * (`ACCESS_CONTROL.BIOMETRY_CURRENT_SET`) instead of the default
   * (`BIOMETRY_ANY`). Defaults to `false`, i.e. today's behaviour, so
   * existing installs are unaffected.
   *
   * With `BIOMETRY_ANY`, anyone who can enrol a new fingerprint/face on an
   * unlocked device can then unlock the vault. With
   * `BIOMETRY_CURRENT_SET` the stored item is bound to the biometric set that
   * existed when it was created, which closes that hole — at a price:
   *
   * **Enabling this makes any legitimate biometric change (adding a finger,
   * re-enrolling Face ID) permanently destroy the master key.** Every sealed
   * record becomes unreadable and the wallet can only be recovered from the
   * seed phrase. Only enable it for wallets whose users are known to hold a
   * backup.
   *
   * The flag is only honoured when the master-key item is **created**: an
   * existing entry keeps whatever policy it was created with, so flipping
   * this on an installed app changes nothing until that entry is removed and
   * recreated.
   */
  invalidateOnEnrollment?: boolean;

  /**
   * App-wide default prompt, used when no per-operation `prompts` entry or
   * `resolvePrompt` result applies. A bare string becomes `{ title }`. See
   * the precedence documented on {@link resolveAuthenticationPrompt}.
   */
  prompt?: string | AuthenticationPrompt;

  /**
   * Per-operation prompt wording, configured once by the host app (e.g.
   * `{ sign: "Authenticate to sign" }`). Checked after `resolvePrompt` and
   * before the app-wide `prompt`.
   */
  prompts?: Partial<Record<AuthenticationOperation, string | AuthenticationPrompt>>;

  /**
   * A formatter that can tailor the prompt to the key being touched (e.g.
   * "Sign with your Algorand account"), checked before `prompts`/`prompt`.
   * Returning `undefined` falls through to `prompts[operation]`.
   *
   * `key` is only supplied when the engine can read it cheaply from the
   * reactive store's already-loaded metadata; it is never worth decrypting
   * material just to build a prompt.
   */
  resolvePrompt?: (context: {
    operation: AuthenticationOperation;
    keyId?: KeyId;
    key?: Key;
  }) => string | AuthenticationPrompt | undefined;

  /**
   * The operation being performed. Populated by the engine for every
   * material-touching call before the context reaches the driver; a caller
   * that explicitly sets this overrides the engine's value.
   */
  operation?: AuthenticationOperation;

  /**
   * The id of the key being operated on, when the call targets one specific
   * key. Populated by the engine; a caller-supplied value is never
   * overwritten.
   */
  keyId?: KeyId;

  /**
   * How long, in seconds, a successful unlock may be reused before the
   * platform re-prompts. Forwarded verbatim to
   * `Keychain.getGenericPassword`/`setGenericPassword`'s
   * `authenticationValidityDuration` option, which requires the pnpm patch
   * at `patches/react-native-keychain@10.0.0.patch` (not yet applied by
   * this package's own `package.json`, since another worker owns it).
   *
   * The platforms apply this very differently:
   *  - **Android**: baked into the Keystore key at creation time via
   *    `setUserAuthenticationValidityDurationSeconds` (default 5s), so it
   *    only takes effect on the read/write that *creates* the master-key
   *    Keychain item; changing it afterwards requires deleting and
   *    recreating that item.
   *  - **iOS**: applied per read as an `LAContext` reuse duration, so it can
   *    be changed freely between reads without recreating anything.
   */
  authenticationValidityDuration?: number;
};
