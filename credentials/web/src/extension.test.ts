import { describe, it, expect } from "vitest";
import Hook from "before-after-hook";
import { memoryCredentialDriver } from "@algorandfoundation/credentials-core";
import type { Credential } from "@algorandfoundation/credentials-core";
import { WithCredentials } from "./extension.ts";
import { webDigitalCredentials } from "./platform.ts";

function createIdentityProvider() {
  const hooks = new Hook.Collection<any>();
  const identityStore = {
    hooks,
    async getIdentity() {
      return undefined;
    },
    async removeIdentity(address: string) {
      return hooks("remove", () => {}, { address });
    },
  };
  return { identity: { store: identityStore } } as any;
}

const mockCredential: Credential = {
  id: "cred-1",
  type: ["VerifiableCredential"],
  identityAddress: "did:key:z1",
  name: "Test",
  format: "vc+sd-jwt",
  raw: "eyJ...~",
  receivedAt: 1,
};

describe("WithCredentials (web)", () => {
  it("mounts without an identities extension (holder binding is optional)", async () => {
    const extension = WithCredentials({} as any, {
      credentials: { driver: memoryCredentialDriver() },
    });

    expect(extension.credential.store).toBeDefined();
    await extension.credential.store.addCredential(mockCredential);
    expect(extension.credentials).toHaveLength(1);
    // Without a binding there is no signer resolution.
    expect(await extension.credential.store.getSignerForIdentity("did:key:z1")).toBeUndefined();
  });

  it("mounts the credential store and attaches the digital platform", async () => {
    const extension = WithCredentials(createIdentityProvider(), {
      credentials: { driver: memoryCredentialDriver() },
    });

    expect(extension.credential.store).toBeDefined();
    expect(extension.credential.digital).toBe(webDigitalCredentials);
    expect(extension.credential.digital.isSupported()).toBe(false);

    await extension.credential.store.addCredential(mockCredential);
    expect(extension.credentials).toHaveLength(1);
  });

  it("auto-binds the identities store for cascade eviction", async () => {
    const provider = createIdentityProvider();
    const extension = WithCredentials(provider, {
      credentials: { driver: memoryCredentialDriver() },
    });

    await extension.credential.store.addCredential(mockCredential);
    await provider.identity.store.removeIdentity("did:key:z1");
    expect(extension.credentials).toHaveLength(0);
  });

  it("persists through an injected key/value driver", async () => {
    const driver = memoryCredentialDriver();
    const extension = WithCredentials(createIdentityProvider(), {
      credentials: { driver, storageKey: "creds" },
    });

    await extension.credential.store.addCredential(mockCredential);
    // Allow hydration to complete before asserting the persisted snapshot.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await extension.credential.store.addCredential({ ...mockCredential, id: "cred-2" });

    expect(JSON.parse((await driver.get("creds"))!)).toHaveLength(2);
  });
});
