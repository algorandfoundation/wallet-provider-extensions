/**
 * @module mount
 *
 * Where a keystore hangs on a provider.
 *
 * A provider can carry more than one keystore: the local OS-keychain one next
 * to a remote daemon, or several named remote services. They all speak the same
 * {@link KeyStoreAPI}, so the only thing that has to be arbitrated is the
 * *name* each one answers to — a
 * {@link import("./types/extension.ts").KeyStoreMount} such as `"store"`
 * (the default, `provider.key.store`), `"rpc"` or `"rpc.ows"`.
 *
 * Extensions are merged onto the provider instance one property at a time, so a
 * second extension returning a fresh `key` object would shadow the first one's.
 * {@link mountKeyStore} therefore folds the new keystore into whatever `key`
 * namespace the provider already has, and refuses to take a name that is
 * already answered.
 */

import type { Store } from "@tanstack/store";

import { KeyStoreMountError } from "./errors.ts";
import type {
  KeyStoreExtensionAt,
  KeyStoreMount,
  KeyStoreState,
  MountedKeyStoreAPI,
} from "./types/extension.ts";

/**
 * The mount path used when none is given: the keystore answers at
 * `provider.key.store`.
 */
export const DEFAULT_KEYSTORE_MOUNT = "store";

/** The separator between the segments of a {@link KeyStoreMount}. */
const MOUNT_SEPARATOR = ".";

/** A group of mounted keystores (and nested groups) under `provider.key`. */
export type KeyStoreNamespace = Record<string, unknown>;

/**
 * Splits a {@link KeyStoreMount} into its segments.
 *
 * @param mount - The dot-separated path, relative to `key`. Defaults to
 *   {@link DEFAULT_KEYSTORE_MOUNT}.
 * @returns The non-empty segments, outermost first.
 * @throws {KeyStoreMountError} If the path is empty or has an empty segment
 *   (e.g. `"rpc."`, `"a..b"`), since either would name nothing.
 *
 * @example
 * ```typescript
 * parseKeyStoreMount("rpc.ows"); // => ["rpc", "ows"]
 * parseKeyStoreMount();          // => ["store"]
 * ```
 */
export function parseKeyStoreMount(mount?: KeyStoreMount): string[] {
  const path = (mount ?? DEFAULT_KEYSTORE_MOUNT).trim();
  if (path.length === 0) {
    throw new KeyStoreMountError("the mount path is empty");
  }
  const segments = path.split(MOUNT_SEPARATOR).map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    throw new KeyStoreMountError(`"${mount}" has an empty path segment`);
  }
  return segments;
}

/** Whether a value looks like a mounted keystore rather than a group. */
function isKeyStoreLeaf(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { sign?: unknown }).sign === "function"
  );
}

/** Reads an existing `key` namespace, tolerating `undefined` and non-objects. */
function asNamespace(value: unknown): KeyStoreNamespace {
  return value !== null && typeof value === "object" ? { ...(value as KeyStoreNamespace) } : {};
}

/**
 * Folds a keystore into a provider's `key` namespace at the given mount path.
 *
 * The existing namespace is never mutated: the objects along the path are
 * copied, so the returned value can be handed straight back as the extension's
 * `key` property.
 *
 * @param options.namespace - The provider's current `key` value, if any.
 * @param options.keystore - The keystore to mount.
 * @param options.mount - Where to mount it; defaults to
 *   {@link DEFAULT_KEYSTORE_MOUNT}.
 * @returns The new `key` namespace, carrying both the existing mounts and this
 *   one.
 * @throws {KeyStoreMountError} If the name is already taken, or if a path
 *   segment would have to reach *through* an already-mounted keystore (e.g.
 *   mounting `"store.ows"` when `store` is a keystore).
 *
 * @example
 * ```typescript
 * // A remote service joining a provider that already has a local keystore
 * const key = mountKeyStore({
 *   namespace: provider.key, // { store: localKeystore }
 *   keystore: remoteKeystore,
 *   mount: "rpc.ows",
 * });
 * // => { store: localKeystore, rpc: { ows: remoteKeystore } }
 * ```
 */
export function mountKeyStore(options: {
  namespace?: unknown;
  keystore: MountedKeyStoreAPI;
  mount?: KeyStoreMount;
}): KeyStoreNamespace {
  const segments = parseKeyStoreMount(options.mount);
  const root = asNamespace(options.namespace);

  let cursor = root;
  segments.forEach((segment, index) => {
    const existing = cursor[segment];
    const path = segments.slice(0, index + 1).join(MOUNT_SEPARATOR);

    if (index === segments.length - 1) {
      if (existing !== undefined) {
        throw new KeyStoreMountError(`"${path}" is already mounted on this provider`);
      }
      cursor[segment] = options.keystore;
      return;
    }

    if (existing === undefined) {
      const group: KeyStoreNamespace = {};
      cursor[segment] = group;
      cursor = group;
      return;
    }
    if (isKeyStoreLeaf(existing)) {
      throw new KeyStoreMountError(`"${path}" is a keystore, not a namespace`);
    }
    const group = asNamespace(existing);
    cursor[segment] = group;
    cursor = group;
  });

  return root;
}

/**
 * Builds the extension surface for a keystore: its mount plus the provider's
 * reactive keystore state.
 *
 * The reactive `keys`/`status`/`algorithms` are defined as live getters (so they
 * track the store) and **only** when the provider does not already expose them:
 * the first keystore to join owns the provider's top-level reactive state, and a
 * keystore that mounts alongside it leaves that state alone rather than
 * silently replacing it. Its own state is always reachable through the `store`
 * it was given.
 *
 * @param options.provider - The host provider the extension is being applied to.
 * @param options.store - The reactive store backing `options.keystore`.
 * @param options.keystore - The keystore to expose.
 * @param options.mount - Where to mount it; defaults to
 *   {@link DEFAULT_KEYSTORE_MOUNT}.
 * @returns The object to return from the extension.
 * @throws {KeyStoreMountError} If the mount path is unusable or already taken.
 *
 * @example
 * ```typescript
 * export const WithKeyStore: Extension<KeyStoreExtension> = (provider, options) =>
 *   createKeyStoreExtension({
 *     provider,
 *     store: options.keystore.store,
 *     keystore: options.api?.keystore ?? createNodeKeyStore({ ...options.keystore }),
 *     mount: options.keystore.mount,
 *   });
 * ```
 */
export function createKeyStoreExtension<Path extends string = "store">(options: {
  provider?: unknown;
  store: Store<KeyStoreState>;
  keystore: MountedKeyStoreAPI;
  mount?: Path;
}): KeyStoreExtensionAt<Path> {
  const { store } = options;
  const provider = options.provider;

  const surface: KeyStoreNamespace = {
    key: mountKeyStore({
      namespace:
        provider !== null && typeof provider === "object"
          ? (provider as { key?: unknown }).key
          : undefined,
      keystore: options.keystore,
      ...(options.mount === undefined ? {} : { mount: options.mount }),
    }),
  };

  const providerOwnsState =
    provider !== null && typeof provider === "object" && "keys" in (provider as object);

  if (!providerOwnsState) {
    Object.defineProperties(surface, {
      keys: {
        get: () => store.state.keys,
        enumerable: true,
        configurable: true,
      },
      status: {
        get: () => store.state.status,
        enumerable: true,
        configurable: true,
      },
      algorithms: {
        get: () => store.state.algorithms ?? [],
        enumerable: true,
        configurable: true,
      },
    });
  }

  return surface as unknown as KeyStoreExtensionAt<Path>;
}
