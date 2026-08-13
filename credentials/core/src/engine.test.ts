import { describe, it, expect, vi } from "vitest";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import {
  createCredentialStore,
  DEFAULT_CREDENTIALS_KEY,
  memoryCredentialDriver,
} from "./engine.ts";
import { identityHolderBinding } from "./holder.ts";
import type { HolderIdentity } from "./holder.ts";
import type { Credential, CredentialStoreState } from "./types.ts";

/**
 * Minimal stand-in for an identities store satisfying the structural
 * `HolderIdentityStore` shape: `getIdentity` + a before-after-hook
 * collection whose `remove` hook drives the cascade.
 */
function createIdentityStore() {
  const identities = new Map<string, HolderIdentity>();
  const hooks = new Hook.Collection<any>();
  return {
    hooks,
    async addIdentity(identity: HolderIdentity) {
      identities.set(identity.address, identity);
      return identity;
    },
    async removeIdentity(address: string) {
      return hooks(
        "remove",
        ({ address }: { address: string }) => {
          identities.delete(address);
        },
        { address },
      );
    },
    async getIdentity(address: string) {
      return identities.get(address);
    },
  };
}

const mockCredential: Credential = {
  id: "cred-1",
  type: ["VerifiableCredential"],
  identityAddress: "did:key:z1",
  name: "Test Credential",
  format: "vc+sd-jwt",
  raw: "eyJ...~",
  receivedAt: 1,
};

describe("createCredentialStore", () => {
  it("creates an in-memory engine without any options (no identities required)", async () => {
    const { api, store, ready } = createCredentialStore();
    await ready;

    expect(store.state.credentials).toEqual([]);
    expect(store.state.issuanceSessions).toEqual([]);
    expect(store.state.verificationSessions).toEqual([]);
    expect(api.hooks).toBeDefined();

    await api.addCredential(mockCredential);
    expect(store.state.credentials).toContainEqual(mockCredential);
    expect(await api.getCredential("cred-1")).toEqual(mockCredential);
    expect(await api.getCredentials()).toHaveLength(1);
    expect(await api.query([{ example: { type: "VerifiableCredential" } }])).toHaveLength(1);

    await api.removeCredential("cred-1");
    expect(store.state.credentials).toEqual([]);
  });

  it("mirrors issuance and verification sessions", async () => {
    const { api, store } = createCredentialStore();

    await api.upsertIssuanceSession({
      id: "iss-1",
      identityAddress: "did:key:z1",
      state: "OfferCreated",
      credentialConfigurationIds: ["device-attestation"],
    });
    await api.upsertVerificationSession({
      id: "ver-1",
      identityAddress: "did:key:z1",
      state: "RequestCreated",
    });

    expect(store.state.issuanceSessions).toHaveLength(1);
    expect(store.state.verificationSessions).toHaveLength(1);
    expect(await api.getIssuanceSessionsByIdentity("did:key:z1")).toHaveLength(1);
    expect(await api.getVerificationSessionsByIdentity("did:key:z1")).toHaveLength(1);

    await api.removeIssuanceSession("iss-1");
    await api.removeVerificationSession("ver-1");
    expect(store.state.issuanceSessions).toEqual([]);
    expect(store.state.verificationSessions).toEqual([]);
  });

  it("triggers hooks on credential operations", async () => {
    const { api } = createCredentialStore();
    const beforeHook = vi.fn();
    api.hooks.before("add", beforeHook);

    await api.addCredential(mockCredential);
    expect(beforeHook).toHaveBeenCalled();
  });

  it("reuses an injected store and hooks", () => {
    const store = new Store<CredentialStoreState>({
      credentials: [mockCredential],
      issuanceSessions: [],
      verificationSessions: [],
    });
    const hooks = new Hook.Collection<any>();
    const engine = createCredentialStore({ store, hooks });

    expect(engine.store).toBe(store);
    expect(engine.api.hooks).toBe(hooks);
    expect(engine.store.state.credentials).toEqual([mockCredential]);
  });

  describe("holder binding", () => {
    it("cascades credential and session eviction when a holder is removed", async () => {
      const identityStore = createIdentityStore();
      const { api, store } = createCredentialStore({
        binding: identityHolderBinding(identityStore),
      });
      await identityStore.addIdentity({ address: "did:key:z1" });

      await api.addCredential(mockCredential);
      await api.addCredential({
        ...mockCredential,
        id: "cred-2",
        identityAddress: "did:key:z2",
      });
      await api.upsertIssuanceSession({
        id: "iss-1",
        identityAddress: "did:key:z1",
        state: "OfferCreated",
        credentialConfigurationIds: [],
      });
      await api.upsertVerificationSession({
        id: "ver-1",
        identityAddress: "did:key:z1",
        state: "RequestCreated",
      });

      await identityStore.removeIdentity("did:key:z1");

      expect(store.state.credentials.map((c) => c.id)).toEqual(["cred-2"]);
      expect(store.state.issuanceSessions).toEqual([]);
      expect(store.state.verificationSessions).toEqual([]);
    });

    it("resolves signers through the binding", async () => {
      const identityStore = createIdentityStore();
      const { api } = createCredentialStore({
        binding: identityHolderBinding(identityStore),
      });
      await identityStore.addIdentity({
        address: "holder-1",
        metadata: { publicKeyJwk: { kty: "OKP" }, kid: "kid-1" },
        sign: async (data: Uint8Array[]) => data.map(() => new Uint8Array([1])),
      });

      const signer = await api.getSignerForIdentity("holder-1");
      expect(signer).toBeDefined();
      expect(signer!.kid).toBe("kid-1");
      expect(await api.getSignerForIdentity("missing")).toBeUndefined();
    });

    it("getSignerForIdentity resolves undefined without a binding", async () => {
      const { api } = createCredentialStore();
      expect(await api.getSignerForIdentity("anything")).toBeUndefined();
    });
  });

  describe("persistence driver", () => {
    it("hydrates the credentials slice from the driver (string and bytes raw)", async () => {
      const bytesCredential: Credential = {
        ...mockCredential,
        id: "cred-bytes",
        format: "mso_mdoc",
        raw: new Uint8Array([1, 2, 3]),
      };
      // Round-trip through a first engine to produce the serialized snapshot.
      const driver = memoryCredentialDriver();
      const first = createCredentialStore({ driver });
      await first.ready;
      await first.api.addCredential(mockCredential);
      await first.api.addCredential(bytesCredential);

      const second = createCredentialStore({ driver });
      await second.ready;

      expect(second.store.state.credentials).toHaveLength(2);
      expect(await second.api.getCredential("cred-1")).toEqual(mockCredential);
      const roundTripped = await second.api.getCredential("cred-bytes");
      expect(roundTripped?.raw).toBeInstanceOf(Uint8Array);
      expect(roundTripped?.raw).toEqual(new Uint8Array([1, 2, 3]));
      // Sessions are transient and must not be hydrated.
      expect(second.store.state.issuanceSessions).toEqual([]);
      expect(second.store.state.verificationSessions).toEqual([]);
    });

    it("persists mutations after hydration under the default key", async () => {
      const driver = memoryCredentialDriver();
      const { api, ready } = createCredentialStore({ driver });
      await ready;

      await api.addCredential(mockCredential);
      const raw = await driver.get(DEFAULT_CREDENTIALS_KEY);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!) as { id: string; raw: { kind: string } }[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("cred-1");
      expect(parsed[0].raw).toEqual({ kind: "string", value: "eyJ...~" });
    });

    it("keeps live records over persisted ones on hydration and honours storageKey", async () => {
      const driver = memoryCredentialDriver({
        custom: JSON.stringify([
          {
            ...mockCredential,
            name: "Persisted",
            raw: { kind: "string", value: "persisted" },
          },
          {
            ...mockCredential,
            id: "cred-2",
            raw: { kind: "string", value: "second" },
          },
        ]),
      });
      const store = new Store<CredentialStoreState>({
        credentials: [mockCredential],
        issuanceSessions: [],
        verificationSessions: [],
      });
      const { api, ready } = createCredentialStore({ store, driver, storageKey: "custom" });
      await ready;

      // The live cred-1 wins; the persisted cred-2 is merged in.
      expect((await api.getCredential("cred-1"))!.name).toBe("Test Credential");
      expect(await api.getCredential("cred-2")).toBeDefined();
      expect(store.state.credentials).toHaveLength(2);
    });

    it("drops a corrupt snapshot instead of failing", async () => {
      const driver = memoryCredentialDriver({ [DEFAULT_CREDENTIALS_KEY]: "{not json" });
      const { api, store, ready } = createCredentialStore({ driver });
      await ready;

      expect(store.state.credentials).toEqual([]);
      await api.addCredential(mockCredential);
      // The next persist overwrites the corrupt payload.
      expect(JSON.parse((await driver.get(DEFAULT_CREDENTIALS_KEY))!)).toHaveLength(1);
    });
  });
});
