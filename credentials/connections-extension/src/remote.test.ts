import { createCredentialStore } from "@algorandfoundation/credentials-core";
import type { Credential, CredentialStoreState } from "@algorandfoundation/credentials-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { isRemoteCredential, remoteCredentialsMirror } from "./remote.ts";

function makeStore(credentials: Credential[] = []): Store<CredentialStoreState> {
  return new Store<CredentialStoreState>({
    credentials,
    issuanceSessions: [],
    verificationSessions: [],
  });
}

function makeLocalCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-local",
    type: ["VerifiableCredential"],
    identityAddress: "did:key:zHOLDER",
    name: "Membership",
    format: "vc+sd-jwt",
    raw: "eyJhbGciOi...",
    claims: { member: true },
    issuer: "did:web:issuer.example",
    receivedAt: 1000,
    ...overrides,
  };
}

describe("remoteCredentialsMirror", () => {
  it("exposes presentation metadata only — no raw payload, claims, or timestamps", () => {
    const store = makeStore([makeLocalCredential()]);

    const exposed = remoteCredentialsMirror(store).expose();

    expect(exposed).toEqual([
      {
        id: "cred-local",
        type: ["VerifiableCredential"],
        identityAddress: "did:key:zHOLDER",
        name: "Membership",
        format: "vc+sd-jwt",
        issuer: "did:web:issuer.example",
      },
    ]);
  });

  it("mirrors peer records into the store tagged with the session discriminant", () => {
    const store = makeStore();
    const mirror = remoteCredentialsMirror(store);

    mirror.receive("session-1", [
      {
        id: "cred-peer",
        type: ["VerifiableCredential"],
        identityAddress: "did:key:zPEER",
        name: "Diploma",
        format: "jwt_vc_json",
      },
    ]);

    const credential = store.state.credentials[0];
    expect(credential.raw).toBe("");
    expect(credential.receivedAt).toBeGreaterThan(0);
    expect(credential.metadata).toMatchObject({ source: "connection", sessionId: "session-1" });
    expect(isRemoteCredential(credential)).toBe(true);
    expect(isRemoteCredential(credential, "session-1")).toBe(true);
    expect(isRemoteCredential(credential, "session-2")).toBe(false);
  });

  it("excludes previously mirrored records from expose (no echo)", () => {
    const store = makeStore([makeLocalCredential()]);
    const mirror = remoteCredentialsMirror(store);

    mirror.receive("session-1", [
      {
        id: "cred-peer",
        type: ["VerifiableCredential"],
        identityAddress: "",
        name: "Peer",
        format: "unknown",
      },
    ]);

    expect(store.state.credentials).toHaveLength(2);
    expect(mirror.expose().map((c) => c.id)).toEqual(["cred-local"]);
  });

  it("replaces a session's previous mirror on receive and revokes per session", () => {
    const store = makeStore([makeLocalCredential()]);
    const mirror = remoteCredentialsMirror(store);
    const record = (id: string) => ({
      id,
      type: ["VerifiableCredential"],
      identityAddress: "",
      name: id,
      format: "unknown",
    });

    mirror.receive("session-1", [record("cred-old")]);
    mirror.receive("session-1", [record("cred-new")]);
    mirror.receive("session-2", [record("cred-other")]);
    expect(store.state.credentials.map((c) => c.id).sort()).toEqual([
      "cred-local",
      "cred-new",
      "cred-other",
    ]);

    mirror.revoke("session-1");
    expect(store.state.credentials.map((c) => c.id).sort()).toEqual(["cred-local", "cred-other"]);

    // Revoking an unknown session is a no-op.
    const before = store.state;
    mirror.revoke("session-unknown");
    expect(store.state).toBe(before);
  });

  it("shares the engine's reactive store when built over it", () => {
    const { api, store } = createCredentialStore();
    const remote = remoteCredentialsMirror(store);

    remote.receive("session-1", [
      {
        id: "cred-peer",
        type: ["VerifiableCredential"],
        identityAddress: "",
        name: "Peer",
        format: "unknown",
      },
    ]);

    expect(store.state.credentials.map((c) => c.id)).toEqual(["cred-peer"]);
    return expect(api.getCredential("cred-peer")).resolves.toMatchObject({ id: "cred-peer" });
  });
});
