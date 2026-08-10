/**
 * @module extension
 *
 * The Wallet Provider extension for a **remote** keystore.
 *
 * It mirrors the platform extensions (`WithKeyStore`, `WithOwsKeyStore`) — same
 * reactive `keys`/`status`/`algorithms`, same
 * {@link import("@algorandfoundation/keystore-core").KeyStoreAPI} — but the
 * keystore it exposes lives in another process, or on another machine, reached
 * through a {@link RemoteTransport}.
 *
 * Because a remote keystore usually joins a provider that *already* has a local
 * one, it is namespaced: a mount decides which name it answers to under
 * `provider.key`, and it is folded into the provider's existing `key` namespace
 * rather than replacing it. That is what makes a named service at
 * `provider.key.rpc.ows` possible next to the local `provider.key.store`.
 */

import {
  createKeyStoreExtension,
  DEFAULT_KEYSTORE_MOUNT,
  type KeyStoreAPI,
  type KeyStoreExtension,
  type KeyStoreExtensionAt,
  type KeyStoreMount,
  type KeyStoreState,
} from "@algorandfoundation/keystore-core";
import type { Extension, ExtensionOptions, Provider } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";

import { createRemoteKeyStore } from "./client.ts";
import type { RemoteTransport } from "./types.ts";

/**
 * The configuration of one remote keystore.
 *
 * There are no `subtle`/`shims` options: the algorithms are whatever the
 * *hosted* keystore supports, and they arrive in the reactive `algorithms`
 * state. Hooks likewise belong to the host — the client only forwards calls.
 */
export interface RemoteKeyStoreBlock {
  /**
   * The reactive store this keystore hydrates from the host's `state` pushes.
   * Give every keystore on a provider its **own** store: sharing one would have
   * them overwrite each other's `keys`.
   */
  store: Store<KeyStoreState>;
  /** How to reach the host. Required unless `api.keystore` is injected. */
  transport?: RemoteTransport;
  /**
   * Where the keystore answers under `provider.key`; defaults to
   * {@link DEFAULT_KEYSTORE_MOUNT} (`"store"`). Give it a name of its own —
   * `"rpc"`, or `"rpc.ows"` for a named service — when a local keystore already
   * holds `key.store`. Ignored when the mount is fixed by
   * {@link withRemoteKeyStoreAt}.
   */
  mount?: KeyStoreMount;
}

/**
 * Remote keystore extension options.
 *
 * The block this extension reads is resolved in three steps, so a remote
 * keystore configures the same way whether it is the provider's only keystore or
 * one of several:
 *
 * 1. `remote[mount]` — one entry per mount, for several remotes on one provider;
 * 2. `remote` — a single remote keystore;
 * 3. `keystore` — the platform extensions' own block, so the remote engine is a
 *    drop-in replacement for a local one.
 */
export interface RemoteKeystoreOptions extends ExtensionOptions {
  /** API configuration */
  api?: {
    /**
     * A ready-made backend to expose as-is (e.g. an already-connected
     * {@link createRemoteKeyStore}, or a local keystore in a test). When
     * present, `transport` is not used.
     */
    keystore?: KeyStoreAPI;
  };
  /**
   * A single remote keystore, or one block per mount path (e.g.
   * `{ "rpc.ows": { store, transport } }`).
   */
  remote?: RemoteKeyStoreBlock | Record<KeyStoreMount, RemoteKeyStoreBlock>;
  /** The platform keystore block, used when no `remote` block is given. */
  keystore?: RemoteKeyStoreBlock;
}

/** Whether a value is a {@link RemoteKeyStoreBlock} rather than a map of them. */
function isBlock(value: unknown): value is RemoteKeyStoreBlock {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { store?: unknown }).store === "object"
  );
}

/**
 * Resolves which configuration block a mount uses.
 *
 * @param options - The provider options.
 * @param mount - The mount being configured.
 * @returns The block.
 * @throws {Error} If none of the three locations holds one.
 */
function resolveBlock(options: RemoteKeystoreOptions, mount: KeyStoreMount): RemoteKeyStoreBlock {
  const remote = options.remote;
  if (remote !== undefined && !isBlock(remote)) {
    const named = (remote as Record<string, RemoteKeyStoreBlock>)[mount];
    if (isBlock(named)) return named;
  }
  if (isBlock(remote)) return remote;
  if (isBlock(options.keystore)) return options.keystore;
  throw new Error(
    `remote keystore "${mount}" has no configuration: expected options.remote["${mount}"], options.remote or options.keystore with a reactive store`,
  );
}

/** Builds the extension surface, shared by both entry points. */
function build(
  provider: unknown,
  options: RemoteKeystoreOptions,
  mount: KeyStoreMount,
): KeyStoreExtension {
  const block = resolveBlock(options, mount);
  const store = block.store;

  // Single source of the API: an injected backend is used as-is, otherwise the
  // client engine is opened over the configured transport.
  const keystore =
    options.api?.keystore ??
    (() => {
      if (block.transport === undefined) {
        throw new Error(
          `remote keystore "${mount}" requires a transport (or an injected options.api.keystore)`,
        );
      }
      return createRemoteKeyStore({ store, transport: block.transport });
    })();

  return createKeyStoreExtension({ provider, store, keystore, mount }) as KeyStoreExtension;
}

/**
 * Wallet Provider Extension that adds a remote keystore.
 *
 * The mount comes from the resolved block's `mount` and defaults to `key.store`,
 * so the extension is a drop-in replacement for a local keystore. When it shares
 * a provider with another keystore, name it — or use
 * {@link withRemoteKeyStoreAt}, which also *types* the mount.
 *
 * @param provider - The host provider.
 * @param options - {@link RemoteKeystoreOptions}. The resolved block needs a
 *   `store`, and a `transport` unless a backend is injected.
 * @returns The {@link KeyStoreExtension} surface, answered by the remote host.
 * @throws {Error} If no block, or neither transport nor injected backend, was
 *   given.
 * @throws {import("@algorandfoundation/keystore-core").KeyStoreMountError} If
 *   the mount path is unusable or already taken on this provider.
 *
 * @example
 * ```typescript
 * const ProviderWithRemote = Provider.withExtensions([WithRemoteKeyStore]);
 * const provider = new ProviderWithRemote(
 *   { id: "wallet", name: "Wallet" },
 *   {
 *     remote: {
 *       store,
 *       transport: createWebSocketTransport({ url: "ws://127.0.0.1:7413" }),
 *       mount: "rpc", // omit for the default `key.store`
 *     },
 *   },
 * );
 *
 * await provider.key.rpc.ready;
 * ```
 */
export const WithRemoteKeyStore: Extension<KeyStoreExtension> = (
  provider: Provider<any>,
  options: RemoteKeystoreOptions,
) => {
  // The mount is needed to find the block, and the block may carry the mount:
  // look under the default name first, then honour what it asks for.
  const declared = resolveBlock(options, DEFAULT_KEYSTORE_MOUNT).mount;
  return build(provider, options, declared ?? DEFAULT_KEYSTORE_MOUNT);
};

/**
 * Creates a remote keystore extension mounted at a **named** path, with the
 * mount reflected in the type — so `provider.key.rpc.ows` is as type-safe as
 * `provider.key.store`.
 *
 * The path given here is authoritative: it also selects the
 * `options.remote[mount]` block, which is how several named services coexist.
 *
 * @param mount - The dot-separated path under `key`, e.g. `"rpc"` or
 *   `"rpc.ows"`.
 * @returns An {@link Extension} exposing the keystore at that path.
 *
 * @example
 * ```typescript
 * // The local keystore keeps `key.store`; the daemon becomes `key.rpc.ows`.
 * const WalletProvider = Provider.withExtensions([
 *   WithKeyStore,
 *   withRemoteKeyStoreAt("rpc.ows"),
 * ]);
 *
 * const provider = new WalletProvider(
 *   { id: "wallet", name: "Wallet" },
 *   {
 *     keystore: { store: localStore, hooks },
 *     remote: { "rpc.ows": { store: remoteStore, transport } },
 *   },
 * );
 *
 * await provider.key.rpc.ows.sign(id, bytes);
 * ```
 */
export function withRemoteKeyStoreAt<const Path extends string>(
  mount: Path,
): Extension<KeyStoreExtensionAt<Path>> {
  return (provider: Provider<any>, options: RemoteKeystoreOptions) =>
    build(provider, options, mount) as unknown as KeyStoreExtensionAt<Path>;
}
