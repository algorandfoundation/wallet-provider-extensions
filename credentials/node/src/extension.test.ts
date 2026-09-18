import { describe, it, expect, vi } from "vitest";
import Hook from "before-after-hook";
import { memoryCredentialDriver } from "@algorandfoundation/credentials-core";
import type { Credential } from "@algorandfoundation/credentials-core";
import { WithCredentials } from "./extension.ts";
import { nodeDigitalCredentials } from "./platform.ts";

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

describe("WithCredentials (node)", () => {
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

  it("mounts the credential store and attaches the node digital stub", async () => {
    const extension = WithCredentials(createIdentityProvider(), {
      credentials: { driver: memoryCredentialDriver() },
    });

    expect(extension.credential.store).toBeDefined();
    expect(extension.credential.digital).toBe(nodeDigitalCredentials);
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

  it("auto-loads the connections bridge and exposes store.ready", async () => {
    const extension = WithCredentials({} as any, {
      credentials: { driver: memoryCredentialDriver() },
    });
    // The reference a consumer takes before the bridge resolves...
    const namespace = extension.credential;

    // The remote mirror is attached once the dynamic bridge import resolves;
    // `store.ready` settles exactly when it (and hydration) has.
    await extension.credential.store.ready;
    expect(extension.credential.remote).toBeDefined();
    // ...carries the mirror too: the namespace is shared, not shallow-copied.
    expect(namespace.remote).toBe(extension.credential.remote);

    // Records the mirror receives ride the engine's reactive store.
    extension.credential.remote!.receive("session-1", [
      {
        id: "cred-peer",
        type: ["VerifiableCredential"],
        identityAddress: "",
        name: "Peer",
        format: "unknown",
      },
    ]);
    expect(extension.credentials.map((c) => c.id)).toEqual(["cred-peer"]);
    // Session mirrors never echo back through expose.
    expect(extension.credential.remote!.expose()).toEqual([]);
  });

  it("degrades gracefully when the bridge module is unavailable", async () => {
    vi.doMock("@algorandfoundation/credentials-connections-extension", () => {
      throw new Error("Cannot find module '@algorandfoundation/credentials-connections-extension'");
    });
    try {
      // Mounting must not throw; the bridge import rejection is swallowed.
      const extension = WithCredentials({} as any, {
        credentials: { driver: memoryCredentialDriver() },
      });

      // `ready` still resolves (never rejects) when the bridge is missing.
      await expect(extension.credential.store.ready).resolves.toBeUndefined();

      expect(extension.credential.remote).toBeUndefined();
      // The local store surface still works without the bridge.
      await extension.credential.store.addCredential(mockCredential);
      expect(extension.credentials).toHaveLength(1);
    } finally {
      vi.doUnmock("@algorandfoundation/credentials-connections-extension");
    }
  });
});
