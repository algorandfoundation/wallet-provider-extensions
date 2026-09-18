/**
 * The **generic domain seam** of the connections package.
 *
 * A {@link ConnectionDomain} is one inventory a peer can announce and
 * exchange during `connect`: accounts, identities, passkeys,
 * credentials, or anything a future extension mounts. The seam is
 * deliberately structural: each domain's **connections bridge**
 * (`@algorandfoundation/<domain>-connections-extension`) exports plain
 * `{ expose, receive, revoke }` helpers in pure store semantics and
 * mounts them at `provider.<ns>.remote` (the domain metas auto-load the
 * bridge), and {@link discoverDomains} assembles the
 * {@link ConnectionDomain}s by probing the provider surface. Mounting a
 * store extension is what announces its domain (with the bridge, it
 * also exchanges records); applications declare nothing.
 *
 * Wire shape: `Record<domainId, records[]>` in both directions of the
 * `connect` handshake; the keys double as the peer's supported-domain
 * announcement (an empty array means "supported, nothing shared").
 *
 * @remarks
 * Deliberately minimal and INFORMAL: the upcoming negotiation work
 * (WalletConnect messages / DIDComm pending) will fold it into a proper
 * capability exchange.
 */

import type { LogStoreApi } from "@algorandfoundation/logs";

import type { ConnectionSession } from "./types.ts";

/**
 * Context accompanying a domain's {@link ConnectionDomain.receive}.
 *
 * The one thing that genuinely differs between a local and a remote
 * record is its `sign` method: locally it is backed by secret material
 * in the engine/keystore; over a connection it becomes a session-routed
 * RPC. Functions never travel the wire, so the engine passes this
 * context and the domain's mirror helper re-attaches `sign` per record.
 *
 * @example
 * ```typescript
 * receive(sessionId, records, context) {
 *   store.mirror(sessionId, records.map((r) => ({ ...r, sign: context?.sign?.(r) })));
 * }
 * ```
 */
export interface DomainReceiveContext {
  /**
   * Session-routed signer factory targeting the connection's
   * `sign_transactions` RPC: builds the `sign(txns)` implementation a
   * mirror re-attaches to one received record. Absent when the
   * receiving side has no signing path back to the peer (e.g. the
   * wallet receiving the dapp's records).
   */
  sign?: (record: unknown) => (txns: Uint8Array[]) => Promise<Uint8Array[]>;
}

/**
 * One connection domain: a stable id plus the lifecycle hooks the
 * hosting engine drives around a session.
 *
 * All hooks are optional: a domain without `expose` is announce-only
 * (its id travels with an empty records array), one without
 * `receive`/`revoke` simply ignores the peer's records.
 *
 * @template Id - The literal domain id (preserved for {@link InferPeerDomains}).
 * @template T - The domain's record type, i.e. the domain store's existing
 * public record shape (the stores hold nothing but public projections,
 * so no separate wire types exist).
 *
 * @example
 * ```typescript
 * const passkeys: ConnectionDomain<"passkeys", Passkey> = {
 *   id: "passkeys",
 *   expose: () => passkeyStore.list(),
 * };
 * ```
 */
export interface ConnectionDomain<Id extends string = string, T = unknown> {
  /** Stable domain id announced in `connect` (e.g. `passkeys`). */
  id: Id;
  /** Resolves the local records exposed to the peer (omit = announce-only). */
  expose?(): T[] | Promise<T[]>;
  /** Peer records arrived for a session; e.g. feed the domain store. */
  receive?(sessionId: string, records: T[], context?: DomainReceiveContext): void | Promise<void>;
  /** The session ended; clear whatever {@link ConnectionDomain.receive} mirrored. */
  revoke?(sessionId: string): void | Promise<void>;
}

/**
 * A readonly list of {@link ConnectionDomain}s: the constraint (and
 * default) for the domains seat across the engines and
 * {@link InferPeerDomains}.
 *
 * @example
 * ```typescript
 * const domains: ConnectionDomains = [defineDomain({ id: "accounts" })];
 * ```
 */
export type ConnectionDomains = readonly ConnectionDomain<any, any>[];

/**
 * The peer shape inferred from a domain tuple (mirrors the provider's
 * `InferExtensions`): each domain's literal id becomes an optional key
 * typed to its record array.
 *
 * @template D - The domain tuple (e.g. built with {@link defineDomain}).
 *
 * @example
 * ```typescript
 * const domains = [defineDomain<"accounts", Account>({ id: "accounts" })] as const;
 * type Peer = InferPeerDomains<typeof domains>; // { accounts?: Account[] }
 * ```
 */
export type InferPeerDomains<D extends ConnectionDomains> = {
  [E in D[number] as E["id"]]?: E extends ConnectionDomain<any, infer T> ? T[] : never;
};

/**
 * Identity factory preserving the literal `Id` for inference, the only
 * "adapter" API a custom domain needs.
 *
 * @param domain - The {@link ConnectionDomain} literal.
 * @returns The same domain, with its literal id type intact.
 *
 * @example
 * ```typescript
 * const notes = defineDomain({
 *   id: "notes",
 *   expose: () => noteStore.list(),
 *   receive: (sessionId, records) => noteStore.mirror(sessionId, records),
 *   revoke: (sessionId) => noteStore.unmirror(sessionId),
 * });
 * ```
 */
export function defineDomain<Id extends string, T>(
  domain: ConnectionDomain<Id, T>,
): ConnectionDomain<Id, T> {
  return domain;
}

/**
 * The registry the hosting engine drives a session's domain lifecycle
 * through, built from the discovered (or explicitly registered)
 * domains right before each handshake.
 *
 * @example
 * ```typescript
 * const registry = createDomainRegistry(discoverDomains(provider));
 * const exposed = await registry.expose(); // { accounts: [...], identities: [...] }
 * ```
 */
export interface ConnectionDomainRegistry {
  /** The ids of every registered domain, in registration order. */
  ids(): string[];
  /**
   * Collects every domain's {@link ConnectionDomain.expose} into the
   * wire map. Announce-only domains contribute an empty array.
   */
  expose(): Promise<Record<string, unknown[]>>;
  /**
   * Routes a wire map to the matching domains'
   * {@link ConnectionDomain.receive}, threading the context. Unknown
   * ids are ignored (forward compatibility) and a throwing `receive`
   * is logged and skipped: inbound records must never fail a handshake.
   */
  receive(
    sessionId: string,
    domains: Record<string, unknown[]>,
    context?: DomainReceiveContext,
  ): Promise<void>;
  /** Fans a session's end out to every domain's {@link ConnectionDomain.revoke}. */
  revoke(sessionId: string): Promise<void>;
}

/**
 * Options accepted by {@link createDomainRegistry}.
 *
 * @example
 * ```typescript
 * const registry = createDomainRegistry(domains, { log: provider.log });
 * ```
 */
export interface CreateDomainRegistryOptions {
  /** Optional logger (typically `provider.log`). */
  log?: LogStoreApi;
}

/**
 * Creates a {@link ConnectionDomainRegistry} from a list of domains.
 *
 * Later registrations win on duplicate ids, so an explicit
 * `options.connections.domains` entry can override a discovered one
 * wholesale.
 *
 * @param domains - The {@link ConnectionDomains} to register.
 * @param options - {@link CreateDomainRegistryOptions}.
 * @returns The {@link ConnectionDomainRegistry}.
 *
 * @example
 * ```typescript
 * const registry = createDomainRegistry([
 *   defineDomain({ id: "accounts", expose: () => accountStore.list() }),
 * ]);
 * await registry.receive(sessionId, peerDomains);
 * ```
 */
export function createDomainRegistry(
  domains: ConnectionDomains = [],
  options: CreateDomainRegistryOptions = {},
): ConnectionDomainRegistry {
  const byId = new Map<string, ConnectionDomain<any, any>>();
  for (const domain of domains) {
    byId.set(domain.id, domain);
  }

  return {
    ids(): string[] {
      return [...byId.keys()];
    },

    async expose(): Promise<Record<string, unknown[]>> {
      const exposed: Record<string, unknown[]> = {};
      for (const [id, domain] of byId) {
        exposed[id] = domain.expose ? [...(await domain.expose())] : [];
      }
      return exposed;
    },

    async receive(
      sessionId: string,
      records: Record<string, unknown[]>,
      context?: DomainReceiveContext,
    ): Promise<void> {
      for (const [id, values] of Object.entries(records ?? {})) {
        const domain = byId.get(id);
        if (!domain?.receive || !Array.isArray(values)) continue;
        try {
          await domain.receive(sessionId, values, context);
        } catch (e) {
          options.log?.warn(
            `domain ${id} receive failed for session ${sessionId}: ${String(e)}`,
            {},
            "ConnectionDomains",
          );
        }
      }
    },

    async revoke(sessionId: string): Promise<void> {
      for (const [id, domain] of byId) {
        if (!domain.revoke) continue;
        try {
          await domain.revoke(sessionId);
        } catch (e) {
          options.log?.warn(
            `domain ${id} revoke failed for session ${sessionId}: ${String(e)}`,
            {},
            "ConnectionDomains",
          );
        }
      }
    },
  };
}

/**
 * Typed runtime accessor: the records a session's peer exposed for one
 * domain. The runtime companion of {@link InferPeerDomains}.
 *
 * @param session - The {@link ConnectionSession} to read.
 * @param domain - The {@link ConnectionDomain} whose records to resolve.
 * @returns The peer's records for the domain (empty when it exposed none).
 *
 * @example
 * ```typescript
 * const peerAccounts = domainRecords(session, accountsDomain); // Account[]
 * ```
 */
export function domainRecords<Id extends string, T>(
  session: ConnectionSession,
  domain: ConnectionDomain<Id, T>,
): T[] {
  return (session.peer?.domains?.[domain.id] as T[] | undefined) ?? [];
}

/**
 * One entry of the {@link DOMAIN_NAMESPACES} map: which options slice
 * may override the mount and which namespace the domain conventionally
 * lives under.
 *
 * @example
 * ```typescript
 * const entry: DomainNamespaceEntry = { optionsKey: "passkeys", namespace: "passkey" };
 * ```
 */
export interface DomainNamespaceEntry {
  /** The extension's `options.<domain>` key (e.g. `passkeys`). */
  optionsKey: string;
  /** The conventional provider namespace (e.g. `passkey`). */
  namespace: string;
}

/**
 * The default `domainId → namespace` map {@link discoverDomains} probes
 * the provider surface with.
 *
 * The keystore (`key.store`) is deliberately absent: secret material is
 * never a connection domain.
 *
 * @example
 * ```typescript
 * const domains = discoverDomains(provider, {
 *   ...DOMAIN_NAMESPACES,
 *   notes: { optionsKey: "notes", namespace: "note" },
 * });
 * ```
 */
export const DOMAIN_NAMESPACES: Readonly<Record<string, DomainNamespaceEntry>> = {
  accounts: { optionsKey: "accounts", namespace: "account" },
  identities: { optionsKey: "identities", namespace: "identity" },
  passkeys: { optionsKey: "passkeys", namespace: "passkey" },
  credentials: { optionsKey: "credentials", namespace: "credential" },
};

/**
 * The remote-mirror surface a domain's connections bridge mounts at
 * `provider.<ns>.remote`: a {@link ConnectionDomain} minus the `id`,
 * in pure store semantics. The bridge packages implement it against the
 * shared domain store; {@link discoverDomains} attaches the id.
 *
 * @template T - The domain's record type.
 *
 * @example
 * ```typescript
 * const remote: RemoteDomainSurface<Account> = {
 *   expose: () => accountStore.list(),
 *   receive: (sessionId, records) => accountStore.mirror(sessionId, records),
 *   revoke: (sessionId) => accountStore.unmirror(sessionId),
 * };
 * ```
 */
export interface RemoteDomainSurface<T = unknown> {
  /** Resolves the local records exposed to the peer. */
  expose?(): T[] | Promise<T[]>;
  /** Peer records arrived for a session; feed the domain store. */
  receive?(sessionId: string, records: T[], context?: DomainReceiveContext): void | Promise<void>;
  /** The session ended; clear whatever `receive` mirrored. */
  revoke?(sessionId: string): void | Promise<void>;
}

/**
 * Probes the provider surface for mounted connection domains: every
 * {@link DOMAIN_NAMESPACES} entry whose resolved namespace mounts a
 * `store` becomes a {@link ConnectionDomain}, whose lifecycle hooks are
 * the duck-typed {@link RemoteDomainSurface} at `provider.<ns>.remote`,
 * mounted by the domain's connections bridge (announce-only when no
 * bridge has mounted a `remote`).
 *
 * The probe runs at CALL time: engines invoke it lazily per handshake,
 * so extension application order never matters. Namespace resolution
 * mirrors `resolveNamespace` of `@algorandfoundation/wallet-provider`:
 * the reserved `namespace` primitive on the extension's options slice
 * overrides the conventional default.
 *
 * @param provider - The provider instance (or any structural twin).
 * @param map - The `domainId → namespace` map to probe with; defaults
 * to {@link DOMAIN_NAMESPACES}.
 * @returns The discovered {@link ConnectionDomains}.
 *
 * @example
 * ```typescript
 * const registry = createDomainRegistry(discoverDomains(provider), { log: provider.log });
 * ```
 */
export function discoverDomains(
  provider: Record<string, any>,
  map: Readonly<Record<string, DomainNamespaceEntry>> = DOMAIN_NAMESPACES,
): ConnectionDomains {
  const domains: ConnectionDomain<string, unknown>[] = [];
  for (const [id, entry] of Object.entries(map)) {
    // Inlined `resolveNamespace` (wallet-provider); the options slice's
    // reserved `namespace` primitive wins over the conventional default.
    const override = (provider?.options as Record<string, any> | undefined)?.[entry.optionsKey]
      ?.namespace;
    const namespace =
      typeof override === "string" && override.length > 0 ? override : entry.namespace;
    const mount = provider?.[namespace] as
      | { store?: unknown; remote?: RemoteDomainSurface }
      | undefined;
    if (!mount?.store) continue;
    const remote = mount.remote;
    domains.push({
      id,
      ...(remote?.expose ? { expose: (): unknown[] | Promise<unknown[]> => remote.expose!() } : {}),
      ...(remote?.receive
        ? {
            receive: (
              sessionId: string,
              records: unknown[],
              context?: DomainReceiveContext,
            ): void | Promise<void> => remote.receive!(sessionId, records, context),
          }
        : {}),
      ...(remote?.revoke
        ? { revoke: (sessionId: string): void | Promise<void> => remote.revoke!(sessionId) }
        : {}),
    });
  }
  return domains;
}
