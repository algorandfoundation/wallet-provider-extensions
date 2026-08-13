import { describe, it, expect, vi } from "vitest";
import Hook from "before-after-hook";
import { createCredentialStore, identityHolderBinding } from "@algorandfoundation/credentials-core";
import type { IntermezzoClient } from "@algorandfoundation/intermezzo-client";
import { WithIntermezzoCredentials } from "./extension.ts";

const DID = "did:key:z6MkTestHolder";

/**
 * Builds a provider that already carries the identities surface and the
 * credential store engine (as a platform `WithCredentials` extension
 * would mount it) — the mount prerequisite for the bridge.
 */
function createCredentialProvider() {
  const hooks = new Hook.Collection<any>();
  const identityStore = {
    hooks,
    async getIdentity(address: string) {
      return address === DID ? { address: DID, type: "did:key", did: DID } : undefined;
    },
  };
  const { api, store } = createCredentialStore({ binding: identityHolderBinding(identityStore) });
  return {
    identity: { store: identityStore },
    credential: { store: api },
    get credentials() {
      return store.state.credentials;
    },
    get issuanceSessions() {
      return store.state.issuanceSessions;
    },
    get verificationSessions() {
      return store.state.verificationSessions;
    },
  } as any;
}

function createMockClient() {
  return {
    createOffer: vi.fn().mockResolvedValue({
      id: "offer-1",
      credoIssuanceSessionId: "credo-1",
      credentialOffer: "openid-credential-offer://...",
      state: "OfferCreated",
      holderDidKey: DID,
    }),
    createPresentationRequest: vi.fn().mockResolvedValue({
      id: "request-1",
      credoVerificationSessionId: "credo-2",
      authorizationRequest: "openid4vp://...",
      state: "RequestCreated",
    }),
    listIssuanceSessions: vi.fn().mockResolvedValue([
      {
        id: "remote-iss-1",
        state: "OfferUriRetrieved",
        credentialConfigurationIds: ["device-attestation"],
        credentialOffer: "openid-credential-offer://...",
        holderDidKey: DID,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    getIssuanceSession: vi.fn().mockResolvedValue({
      id: "remote-iss-1",
      state: "CredentialIssued",
      holderDidKey: DID,
    }),
    listVerificationSessions: vi.fn().mockResolvedValue([
      {
        id: "remote-ver-1",
        state: "RequestCreated",
        authorizationRequest: "openid4vp://...",
      },
    ]),
    getVerificationSession: vi.fn().mockResolvedValue({
      id: "remote-ver-1",
      state: "ResponseVerified",
      verifiedClaims: { vct: "device-attestation" },
    }),
  } as unknown as IntermezzoClient;
}

describe("WithIntermezzoCredentials", () => {
  it("throws when the credentials extension is not mounted", () => {
    expect(() =>
      WithIntermezzoCredentials({} as any, { intermezzo: { baseUrl: "https://x" } }),
    ).toThrow(/requires WithCredentials/);
  });

  it("throws without a baseUrl or pre-built client", () => {
    const provider = createCredentialProvider();
    expect(() => WithIntermezzoCredentials(provider as any, { intermezzo: {} as any })).toThrow(
      /requires options\.intermezzo\.baseUrl/,
    );
  });

  it("reuses an injected options.intermezzo.client instance", () => {
    const provider = createCredentialProvider();
    const client = createMockClient();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client } as any,
    });

    expect(extension.credential.intermezzo.client).toBe(client);
    // The credential store surface mounted earlier is preserved.
    expect(extension.credential.store).toBe(provider.credential.store);
  });

  it("createOffer resolves the holder did:key and mirrors the session locally", async () => {
    const provider = createCredentialProvider();
    const client = createMockClient();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client } as any,
    });

    const response = await extension.credential.intermezzo.createOffer({
      identityAddress: DID,
      credentialConfigurationIds: ["device-attestation"],
    });

    expect(client.createOffer).toHaveBeenCalledWith({
      credentialConfigurationIds: ["device-attestation"],
      holderDidKey: DID,
      issuanceMetadata: undefined,
    });
    expect(response.id).toBe("offer-1");

    const sessions = await extension.credential.store.getIssuanceSessionsByIdentity(DID);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "offer-1",
      identityAddress: DID,
      state: "OfferCreated",
      credentialOfferUri: "openid-credential-offer://...",
    });
  });

  it("rejects createOffer for unknown identities", async () => {
    const provider = createCredentialProvider();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client: createMockClient() } as any,
    });

    await expect(
      extension.credential.intermezzo.createOffer({
        identityAddress: "did:key:zUnknown",
        credentialConfigurationIds: ["device-attestation"],
      }),
    ).rejects.toThrow(/unknown identity/);
  });

  it("mirrors remote issuance sessions, scoping them via holderDidKey", async () => {
    const provider = createCredentialProvider();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client: createMockClient() } as any,
    });

    const sessions = await extension.credential.intermezzo.refreshIssuanceSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "remote-iss-1",
      identityAddress: DID,
      state: "OfferUriRetrieved",
      credentialConfigurationIds: ["device-attestation"],
    });
    expect(await extension.credential.store.getIssuanceSessionsByIdentity(DID)).toHaveLength(1);
  });

  it("preserves the local identity scope when refreshing an existing mirror", async () => {
    const provider = createCredentialProvider();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client: createMockClient() } as any,
    });

    // Seed a local mirror scoped to the identity (as createPresentationRequest does).
    await extension.credential.store.upsertVerificationSession({
      id: "remote-ver-1",
      identityAddress: DID,
      state: "RequestCreated",
    });

    const refreshed =
      await extension.credential.intermezzo.refreshVerificationSession("remote-ver-1");

    expect(refreshed.identityAddress).toBe(DID);
    expect(refreshed.state).toBe("ResponseVerified");
    expect(refreshed.metadata).toEqual({ verifiedClaims: { vct: "device-attestation" } });
  });

  it("createPresentationRequest mirrors the verification session for the responder", async () => {
    const provider = createCredentialProvider();
    const client = createMockClient();
    const extension = WithIntermezzoCredentials(provider as any, {
      intermezzo: { client } as any,
    });

    await extension.credential.intermezzo.createPresentationRequest({
      identityAddress: DID,
      presentationDefinition: { id: "pd-1", input_descriptors: [] },
    });

    const sessions = await extension.credential.store.getVerificationSessionsByIdentity(DID);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "request-1",
      identityAddress: DID,
      state: "RequestCreated",
      authorizationRequest: "openid4vp://...",
    });
  });
});
