import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "@tanstack/store";
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
  CredentialStoreState,
  IssuanceSession,
  VerificationSession,
} from "./types.ts";

describe("Credential Store", () => {
  let store: Store<CredentialStoreState>;

  beforeEach(() => {
    store = new Store<CredentialStoreState>({
      credentials: [],
      issuanceSessions: [],
      verificationSessions: [],
    });
  });

  const mockCredential: Credential = {
    id: "cred-1",
    type: ["VerifiableCredential", "DeviceAttestationCredential"],
    identityAddress: "did:key:z1",
    name: "Device Attestation",
    format: "vc+sd-jwt",
    raw: "eyJ...~",
    receivedAt: 1,
  };

  const mockIssuanceSession: IssuanceSession = {
    id: "iss-1",
    identityAddress: "did:key:z1",
    state: "OfferCreated",
    credentialConfigurationIds: ["device-attestation"],
  };

  const mockVerificationSession: VerificationSession = {
    id: "ver-1",
    identityAddress: "did:key:z1",
    state: "RequestCreated",
  };

  it("should add a credential", () => {
    const result = addCredential({ store, credential: mockCredential });
    expect(result).toEqual(mockCredential);
    expect(store.state.credentials).toContainEqual(mockCredential);
  });

  it("should replace an existing credential with the same id", () => {
    addCredential({ store, credential: mockCredential });
    const updated = { ...mockCredential, name: "Renamed" };
    addCredential({ store, credential: updated });
    expect(store.state.credentials).toHaveLength(1);
    expect(store.state.credentials[0].name).toBe("Renamed");
  });

  it("should remove a credential by id", () => {
    addCredential({ store, credential: mockCredential });
    removeCredential({ store, id: "cred-1" });
    expect(store.state.credentials).toEqual([]);
  });

  it("should get a credential by id", () => {
    addCredential({ store, credential: mockCredential });
    expect(getCredential({ store, id: "cred-1" })).toEqual(mockCredential);
    expect(getCredential({ store, id: "missing" })).toBeUndefined();
  });

  it("should list all credentials", () => {
    addCredential({ store, credential: mockCredential });
    expect(getCredentials({ store })).toEqual([mockCredential]);
  });

  describe("queryCredentials", () => {
    it("returns everything for an empty query list", () => {
      addCredential({ store, credential: mockCredential });
      expect(queryCredentials({ store, queries: [] })).toEqual([mockCredential]);
    });

    it("returns an empty list on an empty store", () => {
      expect(queryCredentials({ store, queries: [] })).toEqual([]);
      expect(
        queryCredentials({ store, queries: [{ example: { type: "VerifiableCredential" } }] }),
      ).toEqual([]);
    });

    it("matches by QueryByExample type", () => {
      addCredential({ store, credential: mockCredential });
      addCredential({
        store,
        credential: { ...mockCredential, id: "cred-2", type: ["VerifiableCredential"] },
      });

      const matched = queryCredentials({
        store,
        queries: [{ example: { type: "DeviceAttestationCredential" } }],
      });
      expect(matched.map((c) => c.id)).toEqual(["cred-1"]);
    });

    it("supports credentialQuery.example and array types", () => {
      addCredential({ store, credential: mockCredential });
      const matched = queryCredentials({
        store,
        queries: [
          {
            credentialQuery: {
              example: { type: ["VerifiableCredential", "DeviceAttestationCredential"] },
            },
          },
        ],
      });
      expect(matched.map((c) => c.id)).toEqual(["cred-1"]);
    });

    it("returns an empty list when no credential matches", () => {
      addCredential({ store, credential: mockCredential });
      const matched = queryCredentials({
        store,
        queries: [{ example: { type: "SomethingElse" } }],
      });
      expect(matched).toEqual([]);
    });

    it("de-duplicates across multiple queries", () => {
      addCredential({ store, credential: mockCredential });
      const matched = queryCredentials({
        store,
        queries: [
          { example: { type: "VerifiableCredential" } },
          { example: { type: "DeviceAttestationCredential" } },
        ],
      });
      expect(matched).toHaveLength(1);
    });
  });

  describe("session mirrors", () => {
    it("upserts and replaces issuance sessions by id", () => {
      upsertIssuanceSession({ store, session: mockIssuanceSession });
      upsertIssuanceSession({
        store,
        session: { ...mockIssuanceSession, state: "CredentialIssued" },
      });
      expect(store.state.issuanceSessions).toHaveLength(1);
      expect(store.state.issuanceSessions[0].state).toBe("CredentialIssued");
    });

    it("removes issuance sessions by id", () => {
      upsertIssuanceSession({ store, session: mockIssuanceSession });
      removeIssuanceSession({ store, id: "iss-1" });
      expect(store.state.issuanceSessions).toEqual([]);
    });

    it("upserts and replaces verification sessions by id", () => {
      upsertVerificationSession({ store, session: mockVerificationSession });
      upsertVerificationSession({
        store,
        session: { ...mockVerificationSession, state: "ResponseVerified" },
      });
      expect(store.state.verificationSessions).toHaveLength(1);
      expect(store.state.verificationSessions[0].state).toBe("ResponseVerified");
    });

    it("removes verification sessions by id", () => {
      upsertVerificationSession({ store, session: mockVerificationSession });
      removeVerificationSession({ store, id: "ver-1" });
      expect(store.state.verificationSessions).toEqual([]);
    });
  });

  describe("identity scoping", () => {
    it("lists credentials and sessions by identity", () => {
      addCredential({ store, credential: mockCredential });
      addCredential({
        store,
        credential: { ...mockCredential, id: "cred-2", identityAddress: "did:key:z2" },
      });
      upsertIssuanceSession({ store, session: mockIssuanceSession });
      upsertVerificationSession({ store, session: mockVerificationSession });

      expect(getCredentialsByIdentity({ store, address: "did:key:z1" }).map((c) => c.id)).toEqual([
        "cred-1",
      ]);
      expect(getIssuanceSessionsByIdentity({ store, address: "did:key:z1" })).toHaveLength(1);
      expect(getVerificationSessionsByIdentity({ store, address: "did:key:z1" })).toHaveLength(1);
      expect(getIssuanceSessionsByIdentity({ store, address: "did:key:z2" })).toEqual([]);
    });

    it("removes everything attached to an identity", () => {
      addCredential({ store, credential: mockCredential });
      addCredential({
        store,
        credential: { ...mockCredential, id: "cred-2", identityAddress: "did:key:z2" },
      });
      upsertIssuanceSession({ store, session: mockIssuanceSession });
      upsertVerificationSession({ store, session: mockVerificationSession });

      removeByIdentity({ store, address: "did:key:z1" });

      expect(store.state.credentials.map((c) => c.id)).toEqual(["cred-2"]);
      expect(store.state.issuanceSessions).toEqual([]);
      expect(store.state.verificationSessions).toEqual([]);
    });
  });

  it("clears credentials and all session mirrors", () => {
    addCredential({ store, credential: mockCredential });
    upsertIssuanceSession({ store, session: mockIssuanceSession });
    upsertVerificationSession({ store, session: mockVerificationSession });

    clearCredentials({ store });

    expect(store.state.credentials).toEqual([]);
    expect(store.state.issuanceSessions).toEqual([]);
    expect(store.state.verificationSessions).toEqual([]);
  });
});
