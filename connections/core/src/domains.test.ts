import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DOMAIN_NAMESPACES,
  createDomainRegistry,
  defineDomain,
  discoverDomains,
  domainRecords,
  type ConnectionDomain,
  type DomainReceiveContext,
  type InferPeerDomains,
} from "./domains.ts";
import type { ConnectionSession } from "./types.ts";

interface StubAccount {
  address: string;
  name: string;
}

interface StubPasskey {
  credentialId: string;
}

function makeSession(overrides: Partial<ConnectionSession> = {}): ConnectionSession {
  return {
    id: "session-1",
    origin: "https://dapp.example",
    status: "connected",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("defineDomain", () => {
  it("returns the domain unchanged, preserving the literal id", () => {
    const domain = defineDomain({
      id: "accounts",
      expose: (): StubAccount[] => [{ address: "ADDR", name: "Main" }],
    });

    expect(domain.id).toBe("accounts");
    expectTypeOf(domain).toEqualTypeOf<ConnectionDomain<"accounts", StubAccount>>();
  });

  it("infers the peer shape from a domain tuple", () => {
    const accounts = defineDomain({
      id: "accounts",
      expose: (): StubAccount[] => [],
    });
    const passkeys = defineDomain({
      id: "passkeys",
      expose: (): StubPasskey[] => [],
    });
    const domains = [accounts, passkeys] as const;

    type Peer = InferPeerDomains<typeof domains>;
    expectTypeOf<Peer["accounts"]>().toEqualTypeOf<StubAccount[] | undefined>();
    expectTypeOf<Peer["passkeys"]>().toEqualTypeOf<StubPasskey[] | undefined>();
  });
});

describe("createDomainRegistry", () => {
  it("lists registered ids in order, later duplicates winning", () => {
    const registry = createDomainRegistry([
      defineDomain({ id: "accounts", expose: () => ["first"] }),
      defineDomain({ id: "passkeys" }),
      defineDomain({ id: "accounts", expose: () => ["second"] }),
    ]);

    expect(registry.ids()).toEqual(["accounts", "passkeys"]);
  });

  it("exposes every domain's records under its id, empty for announce-only domains", async () => {
    const registry = createDomainRegistry([
      defineDomain({
        id: "accounts",
        expose: (): StubAccount[] => [{ address: "ADDR", name: "Main" }],
      }),
      defineDomain({ id: "passkeys" }),
    ]);

    await expect(registry.expose()).resolves.toEqual({
      accounts: [{ address: "ADDR", name: "Main" }],
      passkeys: [],
    });
  });

  it("routes received records to matching domains, threading the context", async () => {
    const receive = vi.fn();
    const registry = createDomainRegistry([
      defineDomain<"accounts", StubAccount>({ id: "accounts", receive }),
    ]);
    const context: DomainReceiveContext = {
      sign: () => async (txns) => txns,
    };

    await registry.receive("session-1", { accounts: [{ address: "ADDR", name: "Main" }] }, context);

    expect(receive).toHaveBeenCalledWith("session-1", [{ address: "ADDR", name: "Main" }], context);
  });

  it("ignores unknown domain ids and malformed record values", async () => {
    const receive = vi.fn();
    const registry = createDomainRegistry([defineDomain({ id: "accounts", receive })]);

    await registry.receive("session-1", {
      unknown: [{ anything: true }],
      accounts: "not an array" as unknown as unknown[],
    });

    expect(receive).not.toHaveBeenCalled();
  });

  it("logs and continues when a domain's receive throws", async () => {
    const warn = vi.fn();
    const received = vi.fn();
    const registry = createDomainRegistry(
      [
        defineDomain({
          id: "accounts",
          receive: () => {
            throw new Error("store unavailable");
          },
        }),
        defineDomain({ id: "passkeys", receive: received }),
      ],
      { log: { warn } as any },
    );

    await expect(
      registry.receive("session-1", { accounts: [], passkeys: [] }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith("session-1", [], undefined);
  });

  it("fans revoke out to every domain, tolerating failures", async () => {
    const warn = vi.fn();
    const revoked = vi.fn();
    const registry = createDomainRegistry(
      [
        defineDomain({
          id: "accounts",
          revoke: () => {
            throw new Error("boom");
          },
        }),
        defineDomain({ id: "passkeys", revoke: revoked }),
        defineDomain({ id: "identities" }),
      ],
      { log: { warn } as any },
    );

    await expect(registry.revoke("session-1")).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(revoked).toHaveBeenCalledWith("session-1");
  });
});

describe("domainRecords", () => {
  const passkeys = defineDomain({
    id: "passkeys",
    expose: (): StubPasskey[] => [],
  });

  it("resolves the peer's records for a domain, typed to its record type", () => {
    const session = makeSession({
      peer: { domains: { passkeys: [{ credentialId: "cred-1" }] } },
    });

    const records = domainRecords(session, passkeys);

    expect(records).toEqual([{ credentialId: "cred-1" }]);
    expectTypeOf(records).toEqualTypeOf<StubPasskey[]>();
  });

  it("returns an empty array when the peer exposed nothing for the domain", () => {
    expect(domainRecords(makeSession(), passkeys)).toEqual([]);
    expect(domainRecords(makeSession({ peer: { domains: {} } }), passkeys)).toEqual([]);
  });
});

describe("discoverDomains", () => {
  /** A stub `provider.<ns>.remote` surface in pure store semantics. */
  function makeRemote(): {
    expose: ReturnType<typeof vi.fn>;
    receive: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  } {
    return { expose: vi.fn(() => []), receive: vi.fn(), revoke: vi.fn() };
  }

  it("discovers a domain per mounted store, wiring the remote surface", async () => {
    const remote = makeRemote();
    remote.expose.mockReturnValue([{ address: "ADDR", name: "Main" }]);
    const provider = {
      options: {},
      account: { store: {}, remote },
      passkey: { store: {} }, // no remote; announce-only
    };

    const domains = discoverDomains(provider);

    expect(domains.map((d) => d.id)).toEqual(["accounts", "passkeys"]);
    const accounts = domains.find((d) => d.id === "accounts")!;
    expect(await accounts.expose!()).toEqual([{ address: "ADDR", name: "Main" }]);
    const context: DomainReceiveContext = {};
    await accounts.receive!("session-1", [], context);
    expect(remote.receive).toHaveBeenCalledWith("session-1", [], context);
    await accounts.revoke!("session-1");
    expect(remote.revoke).toHaveBeenCalledWith("session-1");

    const passkeys = domains.find((d) => d.id === "passkeys")!;
    expect(passkeys.expose).toBeUndefined();
    expect(passkeys.receive).toBeUndefined();
    expect(passkeys.revoke).toBeUndefined();
  });

  it("silently skips domains whose namespace mounts no store", () => {
    const provider = {
      options: {},
      identity: { remote: makeRemote() }, // remote without a store does not count
    };

    expect(discoverDomains(provider)).toEqual([]);
  });

  it("honors the reserved namespace override on the extension's options slice", () => {
    const provider = {
      options: { passkeys: { namespace: "vault" } },
      vault: { store: {}, remote: makeRemote() },
      // The conventional mount stays empty: the surface moved.
    };

    const domains = discoverDomains(provider);

    expect(domains.map((d) => d.id)).toEqual(["passkeys"]);
  });

  it("never discovers the keystore as a domain", () => {
    const provider = {
      options: {},
      key: { store: {}, remote: makeRemote() },
    };

    expect(DOMAIN_NAMESPACES.keystore).toBeUndefined();
    expect(discoverDomains(provider)).toEqual([]);
  });

  it("probes at call time, so extensions mounted later are still discovered", () => {
    const provider: Record<string, any> = { options: {} };

    expect(discoverDomains(provider)).toEqual([]);

    // A store extension applied AFTER the connections engine.
    provider.credential = { store: {} };

    expect(discoverDomains(provider).map((d) => d.id)).toEqual(["credentials"]);
  });
});
