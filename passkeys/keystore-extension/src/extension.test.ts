import { Store } from "@tanstack/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WithPasskeys } from "@algorandfoundation/passkeys-core";
import type { PasskeysExtension, PasskeysState } from "@algorandfoundation/passkeys-core";
import type { Key, KeyStoreState } from "@algorandfoundation/keystore-core";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";

import { WithPasskeysKeystore } from "./extension.ts";
import type { PasskeysKeystoreExtensionOptions } from "./types.ts";

const PUBLIC_KEY = new Uint8Array(65).fill(4);

/** A derived P256 domain key as `deriveDomainKey` mints it. */
function makeDomainKey(overrides: Partial<Key> & { id: string }): Key {
  return {
    type: "hd-derived-p256",
    algorithm: "P256",
    extractable: false,
    publicKey: PUBLIC_KEY,
    metadata: {
      scheme: "pbkdf2-p256",
      parentKeyId: "main-key-1",
      origin: "https://example.com",
      userHandle: "user-1",
      counter: 0,
    },
    ...overrides,
  } as Key;
}

describe("WithPasskeysKeystore Extension", () => {
  let keyStore: Store<KeyStoreState>;
  let passkeysStore: Store<PasskeysState>;
  let passkeysExtension: PasskeysExtension;
  let mockProvider: any;
  let mockOptions: any;
  let removeKey: ReturnType<typeof vi.fn>;

  /** Simulates the keystore engine removing a key and notifying. */
  const applyKeystoreRemoval = (keyId: string) => {
    keyStore.setState((state) => ({
      ...state,
      keys: state.keys.filter((key) => key.id !== keyId),
    }));
  };

  beforeEach(() => {
    keyStore = new Store<KeyStoreState>({ keys: [], status: "idle" });
    passkeysStore = new Store<PasskeysState>({ passkeys: [] });

    // The real core extension backs `provider.passkey.store`, so the
    // bridge is exercised against the actual store API + hooks.
    passkeysExtension = WithPasskeys({ id: "test-wallet" } as never, {
      passkeys: { store: passkeysStore },
    });

    removeKey = vi.fn(async (keyId: string) => {
      applyKeystoreRemoval(keyId);
    });

    mockProvider = {
      id: "test-wallet",
      key: { store: { remove: removeKey, sign: vi.fn() } },
      passkey: passkeysExtension.passkey,
    };

    mockOptions = {
      keystore: { store: keyStore },
      passkeys: { store: passkeysStore },
    };
  });

  it("throws if dependencies are missing", () => {
    expect(() => WithPasskeysKeystore({} as any, mockOptions)).toThrow(/WithPasskeys/);
    expect(() =>
      WithPasskeysKeystore({ passkey: passkeysExtension.passkey } as any, mockOptions),
    ).toThrow(/WithKeyStore/);
  });

  it("subscribes to the keystore", () => {
    const subscribeSpy = vi.spyOn(keyStore, "subscribe");
    WithPasskeysKeystore(mockProvider, mockOptions);
    expect(subscribeSpy).toHaveBeenCalled();
  });

  it("mirrors an existing derived P256 key into the passkeys store on mount", async () => {
    keyStore.setState((state) => ({ ...state, keys: [makeDomainKey({ id: "key+1/a==" })] }));

    WithPasskeysKeystore(mockProvider, mockOptions);

    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys).toHaveLength(1);
    });
    const [passkey] = passkeysStore.state.passkeys;
    // base64url of the key id, WebAuthn style.
    expect(passkey.credentialId).toBe("key-1_a");
    expect(passkey.name).toBe("user-1@https://example.com");
    expect(passkey.publicKey).toBe(PUBLIC_KEY);
    expect(passkey.algorithm).toBe("P256");
    expect(passkey.origin).toBe("https://example.com");
    expect(passkey.userHandle).toBe("user-1");
    expect(passkey.parentKeyId).toBe("main-key-1");
    expect(passkey.metadata).toMatchObject({
      keyId: "key+1/a==",
      keyType: "hd-derived-p256",
      scheme: "pbkdf2-p256",
    });
  });

  it("prefers metadata.label for the passkey name", async () => {
    const key = makeDomainKey({ id: "key-2" });
    key.metadata = { ...key.metadata, label: "My Passkey" };
    keyStore.setState((state) => ({ ...state, keys: [key] }));

    WithPasskeysKeystore(mockProvider, mockOptions);

    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys[0]?.name).toBe("My Passkey");
    });
  });

  it("adds a passkey when a derived key appears after mount", async () => {
    WithPasskeysKeystore(mockProvider, mockOptions);

    keyStore.setState((state) => ({ ...state, keys: [makeDomainKey({ id: "key-3" })] }));

    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys.map((p) => p.credentialId)).toEqual(["key-3"]);
    });
  });

  it("removes the passkey when the backing key is removed, without echoing to the keystore", async () => {
    keyStore.setState((state) => ({ ...state, keys: [makeDomainKey({ id: "key-4" })] }));
    WithPasskeysKeystore(mockProvider, mockOptions);
    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys).toHaveLength(1);
    });

    applyKeystoreRemoval("key-4");

    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys).toHaveLength(0);
    });
    // Keystore-initiated: the reverse observer must NOT call remove.
    expect(removeKey).not.toHaveBeenCalled();
  });

  it("refreshes the passkey when the key's metadata changes", async () => {
    const key = makeDomainKey({ id: "key-5" });
    keyStore.setState((state) => ({ ...state, keys: [key] }));
    WithPasskeysKeystore(mockProvider, mockOptions);
    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys).toHaveLength(1);
    });

    const updated = makeDomainKey({ id: "key-5" });
    updated.metadata = { ...updated.metadata, counter: 7, label: "Renamed" };
    keyStore.setState((state) => ({ ...state, keys: [updated] }));

    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys[0]?.name).toBe("Renamed");
    });
    expect(passkeysStore.state.passkeys).toHaveLength(1);
    expect(passkeysStore.state.passkeys[0]?.metadata?.counter).toBe(7);
  });

  it("removes the backing keystore key exactly once when a bridge-owned passkey is removed", async () => {
    keyStore.setState((state) => ({ ...state, keys: [makeDomainKey({ id: "key-6" })] }));
    WithPasskeysKeystore(mockProvider, mockOptions);
    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys).toHaveLength(1);
    });

    await passkeysExtension.passkey.store.removePasskey("key-6");

    await vi.waitFor(() => {
      expect(removeKey).toHaveBeenCalledExactlyOnceWith("key-6");
    });
    // The keystore removal already dropped the record; no echo loop.
    expect(passkeysStore.state.passkeys).toHaveLength(0);
    expect(keyStore.state.keys).toHaveLength(0);
  });

  it("ignores removals of passkeys the bridge does not own (e.g. native-only records)", async () => {
    WithPasskeysKeystore(mockProvider, mockOptions);
    await passkeysExtension.passkey.store.addPasskey({ credentialId: "native-only" });

    await passkeysExtension.passkey.store.removePasskey("native-only");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removeKey).not.toHaveBeenCalled();
  });

  it("skips derived keys without a public key", async () => {
    const key = makeDomainKey({ id: "key-7" });
    delete (key as { publicKey?: Uint8Array }).publicKey;
    keyStore.setState((state) => ({ ...state, keys: [key] }));

    WithPasskeysKeystore(mockProvider, mockOptions);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passkeysStore.state.passkeys).toHaveLength(0);
  });

  it("ignores non-passkey key types", async () => {
    keyStore.setState((state) => ({
      ...state,
      keys: [
        {
          id: "seed-1",
          type: "seed",
          algorithm: "raw",
          extractable: false,
          publicKey: PUBLIC_KEY,
        } as Key,
        {
          id: "ed-1",
          type: "hd-derived-ed25519",
          algorithm: "EdDSA",
          extractable: false,
          publicKey: PUBLIC_KEY,
        } as Key,
      ],
    }));

    WithPasskeysKeystore(mockProvider, mockOptions);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passkeysStore.state.passkeys).toHaveLength(0);
  });

  it("defers updates while the keystore is in a transient status", async () => {
    WithPasskeysKeystore(mockProvider, mockOptions);

    keyStore.setState((state) => ({
      ...state,
      status: "deriving",
      keys: [makeDomainKey({ id: "key-8" })],
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passkeysStore.state.passkeys).toHaveLength(0);

    keyStore.setState((state) => ({ ...state, status: "ready" }));
    await vi.waitFor(() => {
      expect(passkeysStore.state.passkeys.map((p) => p.credentialId)).toEqual(["key-8"]);
    });
  });

  it("does not populate when autoPopulate is false", async () => {
    keyStore.setState((state) => ({ ...state, keys: [makeDomainKey({ id: "key-9" })] }));

    WithPasskeysKeystore(mockProvider, {
      ...mockOptions,
      passkeys: { ...mockOptions.passkeys, keystore: { autoPopulate: false } },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(passkeysStore.state.passkeys).toHaveLength(0);
  });

  it("registers the keystore block on the shared options.passkeys namespace", () => {
    // Type-level: the bridge's `passkeys.keystore` is typed both on the
    // narrowed bridge options and on the shared ExtensionOptions registry.
    const bridgeOptions: PasskeysKeystoreExtensionOptions = {
      keystore: { store: keyStore, hooks: {} as never },
      passkeys: { store: passkeysStore, keystore: { autoPopulate: false } },
    };
    const registry: ExtensionOptions = bridgeOptions;

    expect(registry.passkeys?.keystore?.autoPopulate).toBe(false);
    expect(registry.passkeys?.store).toBe(passkeysStore);
  });
});
