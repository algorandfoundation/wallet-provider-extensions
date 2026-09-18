import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import type { SubtleShim } from "../shims/index.ts";
import type { KeyStoreAPI } from "./backend.ts";
import type { Key } from "./core.ts";

/**
 * The `options.keystore` namespace the keystore extensions claim on the shared
 * {@link ExtensionOptions} registry.
 *
 * This is the platform-neutral half of the two-level registry: the platform
 * packages (`@algorandfoundation/keystore-node`, `@algorandfoundation/keystore-web`,
 * `@algorandfoundation/react-native-keystore`) **augment** this interface with
 * their own persistence seams (e.g. `keyring`, `indexedDB`, `storage`), so a
 * composition root gets one fully typed `options.keystore` block whichever
 * platform it installs.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/keystore-core" {
 *   interface KeyStoreNamespace {
 *     databaseName?: string;
 *   }
 * }
 * ```
 */
export interface KeyStoreNamespace {
  /** The reactive store holding the UI-safe {@link KeyStoreState}. */
  store: Store<KeyStoreState>;
  /** Hook collection every material-touching operation is routed through. */
  hooks: HookCollection<any>;
  /**
   * Host {@link SubtleCrypto} implementation the engine builds on. Defaults to
   * the platform's Subtle (`globalThis.crypto.subtle` on Node/web; on React
   * Native pass `react-native-quick-crypto`'s `subtle`). Only used when the
   * extension builds the engine itself (no `api.keystore` injected).
   */
  subtle?: SubtleCrypto;
  /**
   * Composable {@link SubtleShim} decorators layered over the host to add the
   * algorithms the keystore needs (e.g. `(host) => withSubtleXHD(host, xhd)`).
   * When omitted, the engine enables the full default set (BIP32-Ed25519,
   * Falcon-1024, Deterministic-P256, BIP39 and Algo25). Only used when the
   * extension builds the engine itself.
   */
  shims?: SubtleShim[];
}

/**
 * The `options.api` namespace: concrete backend implementations injected in
 * place of the engines the extensions would otherwise build.
 */
export interface ApiNamespace {
  /** The optional {@link KeyStoreAPI} backend implementation to use */
  keystore?: KeyStoreAPI;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Injected backend implementations, see {@link ApiNamespace}. */
    api?: ApiNamespace;
    /** Keystore-specific settings, see {@link KeyStoreNamespace}. */
    keystore?: KeyStoreNamespace;
  }
}

/**
 * Configuration for the keystore extension.
 *
 * Narrows the shared {@link ExtensionOptions} registry: the `keystore` block is
 * **required** when a keystore extension is mounted.
 */
export interface KeyStoreOptions extends ExtensionOptions {
  /** API configuration */
  api?: ApiNamespace;
  /** Keystore-specific settings */
  keystore: KeyStoreNamespace;
}

/**
 * Where a keystore algorithm capability comes from.
 *
 * - `"host"`: a standard WebCrypto algorithm provided directly by the host
 *   {@link SubtleCrypto} (e.g. `Ed25519`, `ECDSA`, `AES-GCM`).
 * - `"shim"`: a composable add-on layered over the host by a
 *   {@link import("../shims/index.ts").SubtleShim} (e.g. `Falcon-1024`,
 *   `BIP32-Ed25519`).
 */
export type KeyStoreCapabilitySource = "host" | "shim";

/**
 * A single cryptographic capability the keystore exposes, tagged with where it
 * comes from so a UI can group/label host algorithms separately from the
 * composable shim add-ons.
 */
export interface KeyStoreCapability {
  /** The algorithm identifier (e.g. `"Falcon-1024"`, `"Ed25519"`). */
  algorithm: string;
  /** Whether the algorithm is provided by the host Subtle or a shim add-on. */
  source: KeyStoreCapabilitySource;
}

/**
 * Represents the state of the keystore extension.
 *
 * This state is intentionally UI-safe: it only contains metadata (like key IDs)
 * and status flags. It NEVER contains private key material.
 *
 * @remarks
 * Consumers can subscribe to state changes using TanStack Store selectors.
 * See {@link https://tanstack.com/store/latest docs} for details.
 */
export interface KeyStoreState {
  /** Array of available {@link KeyId}s currently stored by the backend */
  keys: Key[];
  /**
   * Current status of the keystore operation lifecycle.
   *
   * Typical values include:
   * - `"idle"`: no operation in progress
   * - `"generating"`: creating a new key/seed
   * - `"importing"`: importing an existing key
   * - `"deriving"`: deriving a key from a seed
   * - `"signing"`: signing arbitrary data
   * - `"encrypting"` / `"decrypting"`: performing crypto on payloads
   */
  status: string;
  /**
   * The cryptographic algorithms this keystore exposes, each tagged with its
   * {@link KeyStoreCapability.source}:
   *
   * - the standard **host** algorithms it uses directly from its
   *   {@link SubtleCrypto} (e.g. `"Ed25519"`, `"ECDSA"`, `"AES-GCM"`), and
   * - the composable **shim** add-ons layered over the host (e.g.
   *   `"BIP32-Ed25519"`, `"Falcon-1024"`, `"Deterministic-P256"`, `"BIP39"`,
   *   `"Algo25"`).
   *
   * The engine populates this once its shim stack is layered, as part of
   * {@link import("../create.ts").KeyStore.ready}, so the shim entries reflect
   * the add-ons that were actually available at runtime; e.g. Falcon-1024 only
   * appears when its (optional) binding resolved. The host entries are a
   * documented baseline (see
   * {@link import("../constants.ts").DEFAULT_HOST_ALGORITHMS}). It lets a UI
   * enumerate the keystore's capabilities and, for example, only offer to
   * generate keys for algorithms that are present. Absent until `ready`
   * resolves.
   */
  algorithms?: KeyStoreCapability[];
}

/**
 * The interface exposed by the Keystore Extension when added to a Provider.
 */
export interface KeyStoreExtension extends KeyStoreState {
  /** The keystore backend with added support for hooks */
  key: {
    store: KeyStoreAPI & {
      /**
       * Resolves once the engine's shim stack is layered and existing metadata
       * has been hydrated into the reactive store. Await it before relying on the
       * reactive `keys`/`algorithms` (material-touching methods await it
       * internally). **Optional** because a backend injected via
       * `options.api.keystore` may be a plain {@link KeyStoreAPI} without a
       * `ready` phase.
       */
      ready?: Promise<void>;
      /**
       * Hook collection for intercepting keystore operations.
       *
       * The shared `createKeyStore` engine binds this at creation and exposes it
       * on the returned keystore, so extensions surface it directly without
       * re-assigning. It is **optional** because a backend injected via
       * `options.api.keystore` may not have been built with hooks.
       *
       * Supported operation ids include (non-exhaustive):
       * `"generating"`, `"importing"`, `"exporting"`, `"removing"`,
       * `"listing"`, `"getting metadata"`, `"signing"`, `"verifying"`,
       * `"encrypting"`, `"decrypting"`, `"deriving"`, `"importing seed"`,
       * `"logging audit event"`, `"getting audit logs"`, `"batch signing"`.
       *
       * Powered by {@link https://github.com/gr2m/before-after-hook before-after-hook}.
       */
      hooks?: HookCollection<any>;
    };
  };
}
