import type { CredentialStoreState } from "@algorandfoundation/credentials-core";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { WithCredentialsConnections } from "./extension.ts";

function makeStore(): Store<CredentialStoreState> {
  return new Store<CredentialStoreState>({
    credentials: [],
    issuanceSessions: [],
    verificationSessions: [],
  });
}

describe("WithCredentialsConnections", () => {
  it("mounts the remote mirror over the injected shared store", () => {
    const store = makeStore();
    const provider: any = { id: "wallet-1" };

    const extension = WithCredentialsConnections(provider, { credentials: { store } });

    extension.credential.remote.receive("session-1", [
      {
        id: "cred-peer",
        type: ["VerifiableCredential"],
        identityAddress: "",
        name: "Peer",
        format: "unknown",
      },
    ]);
    // The mirror writes into the same reactive store the extension was given.
    expect(store.state.credentials.map((c) => c.id)).toEqual(["cred-peer"]);
  });

  it("is idempotent: reuses an already-mounted remote surface", () => {
    const store = makeStore();
    const provider: any = { id: "wallet-1" };

    const first = WithCredentialsConnections(provider, { credentials: { store } });
    provider.credential = first.credential;
    const second = WithCredentialsConnections(provider, { credentials: { store } });

    expect(second.credential.remote).toBe(first.credential.remote);
  });

  it("throws a clear error when the shared store is missing", () => {
    const provider: any = { id: "wallet-1" };

    expect(() => WithCredentialsConnections(provider)).toThrow(
      "WithCredentialsConnections requires options.credentials.store (the shared credential store)",
    );
  });
});
