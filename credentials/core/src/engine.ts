/**
 * The platform-neutral credential store **engine**.
 *
 * Mirrors the keystore architecture: this package exports no mounted
 * extension of its own. Platform packages
 * (`@algorandfoundation/credentials-web`,
 * `@algorandfoundation/react-native-credentials`, the
 * `@algorandfoundation/credentials` meta) each export a `WithCredentials`
 * extension that builds this engine with a platform-appropriate
 * persistence driver — exactly like `WithKeyStore` builds `createKeyStore`
 * with a platform storage driver.
 *
 * Persistence is a deliberately tiny key/value seam
 * ({@link CredentialKeyValueStore}), shaped after the
 * `KeyValueStore` used by `@algorandfoundation/provider-migrations` so it
 * can graduate into a shared core primitive for any API surface once a
 * second consumer lands. Only the durable `credentials` slice is
 * persisted — OID4VC `issuanceSessions` / `verificationSessions` are
 * transient protocol state and intentionally are not.
 */

import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { LogStoreApi } from "@algorandfoundation/log-store";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import type { HookCollection } from "before-after-hook";

import type { HolderBinding } from "./holder.ts";
import {
  addCredential,
  clearCredentials,
  getCredential,
  getCredentials,
  getCredentialsByIdentity,
  getIssuanceSessionsByIdentity,
  getVerificationSessionsByIdentity,
  queryCredentials,
  removeByIdentity,
  removeCredential,
  removeIssuanceSession,
  removeVerificationSession,
  upsertIssuanceSession,
  upsertVerificationSession,
} from "./store.ts";
import type {
  Credential,
  CredentialStoreApi,
  CredentialStoreState,
  IssuanceSession,
  VerificationSession,
} from "./types.ts";

/**
 * A string key/value persistence seam for the credential store.
 *
 * Shaped after the `KeyValueStore` contract of
 * `@algorandfoundation/provider-migrations` — MMKV, `localStorage`,
 * AsyncStorage, IndexedDB or a file wrapper all adapt in two lines — and
 * intended to be extracted into a shared core primitive once more API
 * surfaces consume it.
 */
export interface CredentialKeyValueStore {
  /** Reads the serialized snapshot; absent keys read as `null`/`undefined`. */
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  /** Persists the serialized snapshot. */
  set(key: string, value: string): void | Promise<void>;
}

/** Default storage key under which the credentials snapshot is serialized. */
export const DEFAULT_CREDENTIALS_KEY: string = "@algorandfoundation/credentials";

/**
 * An in-memory {@link CredentialKeyValueStore}.
 *
 * Nothing survives a restart. Used as the fallback driver by the platform
 * packages (and handy in tests); applications should inject a durable
 * driver via `options.credentials.driver`.
 *
 * @param initial - Key/value pairs to seed the driver with.
 * @returns An in-memory {@link CredentialKeyValueStore}.
 */
export function memoryCredentialDriver(
  initial: Record<string, string> = {},
): CredentialKeyValueStore {
  const state: Record<string, string> = { ...initial };
  return {
    get(key: string): string | undefined {
      return state[key];
    },
    set(key: string, value: string): void {
      state[key] = value;
    },
  };
}

/**
 * `Credential.raw` is `string | Uint8Array`. The JSON serialization tags
 * the variant so the binary path round-trips losslessly through
 * `JSON.parse` (a raw `Uint8Array` would otherwise serialize to a
 * `{"0":..,"1":..}` object that could not be reconstructed).
 */
type SerialisedCredential = Omit<Credential, "raw"> & {
  raw: { kind: "string"; value: string } | { kind: "bytes"; value: number[] };
};

function serialiseCredential(c: Credential): SerialisedCredential {
  const raw: SerialisedCredential["raw"] =
    typeof c.raw === "string"
      ? { kind: "string", value: c.raw }
      : { kind: "bytes", value: Array.from(c.raw) };
  return { ...c, raw };
}

function deserialiseCredential(c: SerialisedCredential): Credential {
  const raw: Credential["raw"] =
    c.raw.kind === "string" ? c.raw.value : new Uint8Array(c.raw.value);
  return { ...c, raw };
}

/**
 * Options accepted by {@link createCredentialStore}.
 */
export interface CreateCredentialStoreOptions {
  /** Reactive store backing the engine; created when not provided. */
  store?: Store<CredentialStoreState>;
  /**
   * Hook collection bound at creation. Every store operation is
   * interceptable via `before`/`after` hooks and is exposed as
   * `api.hooks` — this is how the platform `WithCredentials` extensions
   * thread application hooks into the engine.
   */
  hooks?: HookCollection<any>;
  /**
   * Persistence driver for the durable `credentials` slice. When omitted
   * the store is purely in-memory (no hydration, no persistence).
   */
  driver?: CredentialKeyValueStore;
  /**
   * The {@link HolderBinding} that resolves signers for holder addresses
   * and drives cascade eviction on holder removal. When omitted, mounting
   * still works: `getSignerForIdentity` resolves to `undefined` and no
   * cascade is wired.
   */
  binding?: HolderBinding;
  /** Optional logger (typically `provider.log`). */
  log?: LogStoreApi;
  /** Storage key override; defaults to {@link DEFAULT_CREDENTIALS_KEY}. */
  storageKey?: string;
}

/**
 * The credential store engine: the hooks-wrapped {@link CredentialStoreApi},
 * the reactive store backing it, and a `ready` promise that resolves once
 * hydration from the persistence driver has completed.
 */
export interface CredentialStore {
  /** The API surface extensions expose at `provider.credential.store`. */
  api: CredentialStoreApi;
  /** The reactive tanstack store backing the engine. */
  store: Store<CredentialStoreState>;
  /** Resolves once the driver snapshot has been hydrated (immediately when no driver). */
  ready: Promise<void>;
}

/**
 * Creates the platform-neutral credential store engine.
 *
 * Owns the reactive state, wraps every operation in the hook collection,
 * hydrates from / persists to the {@link CredentialKeyValueStore} driver
 * (durable `credentials` slice only, with tagged `raw` serialization so
 * `Uint8Array` payloads round-trip), and wires the {@link HolderBinding}
 * for signer resolution and cascade eviction.
 *
 * @param options - {@link CreateCredentialStoreOptions}.
 * @returns The {@link CredentialStore} engine.
 *
 * @example
 * ```typescript
 * const { api, store, ready } = createCredentialStore({
 *   driver: keyValueDriver,
 *   binding: identityHolderBinding(provider.identity.store),
 * });
 * await ready;
 * await api.addCredential(credential);
 * ```
 */
export function createCredentialStore(options: CreateCredentialStoreOptions = {}): CredentialStore {
  const log = options.log;
  const store =
    options.store ??
    new Store<CredentialStoreState>({
      credentials: [],
      issuanceSessions: [],
      verificationSessions: [],
    });
  const hooks = options.hooks ?? new Hook.Collection<any>();
  const binding = options.binding;
  const driver = options.driver;
  const storageKey = options.storageKey ?? DEFAULT_CREDENTIALS_KEY;

  // Cascade-evict credentials + sessions whose holder goes away. Wired
  // through the holder-binding seam instead of a hard identities
  // dependency.
  binding?.onRemoved?.((address: string) => {
    log?.info(`cascading credential removal for holder=${address}`, {}, "CredentialStore");
    removeByIdentity({ store, address });
  });

  const api: CredentialStoreApi = {
    addCredential: async (credential: Credential) => {
      log?.info(
        `addCredential called: id=${credential.id}, format=${credential.format}`,
        {},
        "CredentialStore",
      );
      return hooks("add", addCredential, { store, credential });
    },
    removeCredential: async (id: string) => {
      log?.info(`removeCredential called: id=${id}`, {}, "CredentialStore");
      return hooks("remove", removeCredential, { store, id });
    },
    getCredential: async (id: string) => {
      log?.debug(`getCredential called: id=${id}`, {}, "CredentialStore");
      return hooks("get", getCredential, { store, id });
    },
    getCredentials: async () => {
      log?.debug("getCredentials called", {}, "CredentialStore");
      return hooks("list", getCredentials, { store });
    },
    getCredentialsByIdentity: async (address: string) => {
      log?.debug(`getCredentialsByIdentity called: address=${address}`, {}, "CredentialStore");
      return hooks("listByIdentity", getCredentialsByIdentity, { store, address });
    },
    query: async (queries: any[]) => {
      log?.debug("query called", { queries }, "CredentialStore");
      return hooks("query", queryCredentials, { store, queries });
    },
    getIssuanceSessionsByIdentity: async (address: string) => {
      log?.debug(`getIssuanceSessionsByIdentity called: address=${address}`, {}, "CredentialStore");
      return hooks("listIssuanceSessionsByIdentity", getIssuanceSessionsByIdentity, {
        store,
        address,
      });
    },
    getVerificationSessionsByIdentity: async (address: string) => {
      log?.debug(
        `getVerificationSessionsByIdentity called: address=${address}`,
        {},
        "CredentialStore",
      );
      return hooks("listVerificationSessionsByIdentity", getVerificationSessionsByIdentity, {
        store,
        address,
      });
    },
    removeByIdentity: async (address: string) => {
      log?.info(`removeByIdentity called: address=${address}`, {}, "CredentialStore");
      return hooks("removeByIdentity", removeByIdentity, { store, address });
    },
    getSignerForIdentity: async (address: string) => {
      log?.debug(`getSignerForIdentity called: address=${address}`, {}, "CredentialStore");
      if (!binding) return undefined;
      return binding.getSigner(address);
    },
    upsertIssuanceSession: async (session: IssuanceSession) => {
      log?.info(
        `upsertIssuanceSession called: id=${session.id}, state=${session.state}`,
        {},
        "CredentialStore",
      );
      return hooks("upsertIssuanceSession", upsertIssuanceSession, { store, session });
    },
    removeIssuanceSession: async (id: string) => {
      log?.info(`removeIssuanceSession called: id=${id}`, {}, "CredentialStore");
      return hooks("removeIssuanceSession", removeIssuanceSession, { store, id });
    },
    upsertVerificationSession: async (session: VerificationSession) => {
      log?.info(
        `upsertVerificationSession called: id=${session.id}, state=${session.state}`,
        {},
        "CredentialStore",
      );
      return hooks("upsertVerificationSession", upsertVerificationSession, { store, session });
    },
    removeVerificationSession: async (id: string) => {
      log?.info(`removeVerificationSession called: id=${id}`, {}, "CredentialStore");
      return hooks("removeVerificationSession", removeVerificationSession, { store, id });
    },
    clear: async () => {
      log?.info("clear called", {}, "CredentialStore");
      return hooks("clear", clearCredentials, { store });
    },
    hooks,
  };

  // --- persistence -------------------------------------------------------
  // Hydration merges the persisted snapshot under live records (in-store
  // records win by id), so mutations racing hydration are never clobbered.
  // Persistence is suppressed until hydration completes so an empty initial
  // state cannot overwrite a durable snapshot.
  let hydrated = driver === undefined;

  const persist = (): void => {
    if (!driver || !hydrated) return;
    try {
      const snapshot = store.state.credentials.map(serialiseCredential);
      void Promise.resolve(driver.set(storageKey, JSON.stringify(snapshot))).catch((e) => {
        log?.warn(`failed to persist credentials snapshot: ${String(e)}`, {}, "CredentialStore");
      });
    } catch (e) {
      log?.warn(`failed to persist credentials snapshot: ${String(e)}`, {}, "CredentialStore");
    }
  };

  if (driver) {
    store.subscribe(persist);
  }

  const ready: Promise<void> = driver
    ? (async () => {
        let persisted: Credential[] = [];
        try {
          const raw = await driver.get(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as SerialisedCredential[];
            persisted = Array.isArray(parsed) ? parsed.map(deserialiseCredential) : [];
          }
        } catch (e) {
          log?.warn(`dropping corrupt credentials snapshot: ${String(e)}`, {}, "CredentialStore");
        }
        if (persisted.length > 0) {
          store.setState((state) => {
            const live = new Set(state.credentials.map((c) => c.id));
            return {
              ...state,
              credentials: [...persisted.filter((c) => !live.has(c.id)), ...state.credentials],
            };
          });
        }
        hydrated = true;
        persist();
      })()
    : Promise.resolve();

  return { api, store, ready };
}

/**
 * Options accepted by the platform `WithCredentials` extensions.
 *
 * Everything is optional: the platform extension fills in a default
 * reactive store, hook collection and (where the platform has one) a
 * default persistence driver, and auto-binds
 * {@link import("./holder.ts").identityHolderBinding} when an identities
 * extension is present on the provider.
 */
export interface CredentialStoreOptions extends ExtensionOptions {
  credentials?: {
    /** Reactive store backing the engine; created when not provided. */
    store?: Store<CredentialStoreState>;
    /** Hook collection guarding every store operation. */
    hooks?: HookCollection<any>;
    /** Persistence driver; platform default (or in-memory) when omitted. */
    driver?: CredentialKeyValueStore;
    /** Holder binding override; auto-derived from `provider.identity.store` when omitted. */
    binding?: HolderBinding;
    /** Storage key override; defaults to {@link DEFAULT_CREDENTIALS_KEY}. */
    storageKey?: string;
  };
}
