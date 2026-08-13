import { describe, it, expect, vi, beforeEach } from "vitest";
import { Store } from "@tanstack/store";
import { base58 } from "@scure/base";
import { WithIdentitiesKeystore } from "./extension.ts";
import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import type { DIDDocument, IdentityStoreState } from "@algorandfoundation/identities-store";

describe("WithIdentitiesKeystore Extension", () => {
  let keyStore: Store<KeyStoreState>;
  let identityStore: Store<IdentityStoreState>;
  let mockProvider: any;
  let mockOptions: any;

  beforeEach(() => {
    keyStore = new Store<KeyStoreState>({
      keys: [],
      status: "idle",
    });
    identityStore = new Store<IdentityStoreState>({
      identities: [],
    });

    mockProvider = {
      key: {
        store: {
          generate: vi.fn(),
          sign: vi.fn(),
        },
      },
      identity: {
        store: {
          addIdentity: vi.fn(),
          removeIdentity: vi.fn(),
          updateDidDocument: vi.fn(),
        },
      },
    };

    mockOptions = {
      keystore: { store: keyStore },
      identities: { store: identityStore },
    };
  });

  it("should throw if dependencies are missing", () => {
    expect(() => WithIdentitiesKeystore({} as any, mockOptions)).toThrow();
    expect(() => WithIdentitiesKeystore({ identity: {} } as any, mockOptions)).toThrow();
  });

  it("should initialize and subscribe to keystore", () => {
    const subscribeSpy = vi.spyOn(keyStore, "subscribe");
    WithIdentitiesKeystore(mockProvider, mockOptions);
    expect(subscribeSpy).toHaveBeenCalled();
  });

  it("should auto-populate identities from context 1 keys", async () => {
    const publicKey = new Uint8Array(32).fill(1);
    const mockKey = {
      id: "key1",
      type: "hd-derived-ed25519",
      algorithm: "EdDSA",
      extractable: false,
      publicKey,
      metadata: { context: 1 },
    };

    // Set keys in store before extension initialization
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "ready" }));

    WithIdentitiesKeystore(mockProvider, mockOptions);

    // Wait for async processing
    await vi.waitFor(() => {
      expect(mockProvider.identity.store.addIdentity).toHaveBeenCalled();
    });

    const calledIdentity = mockProvider.identity.store.addIdentity.mock.calls[0][0];
    expect(calledIdentity.address).toBeDefined();
    expect(calledIdentity.metadata.keyId).toBe("key1");
  });

  it("should not populate from context 0 keys", async () => {
    const publicKey = new Uint8Array(32).fill(1);
    const mockKey = {
      id: "key1",
      type: "hd-derived-ed25519",
      algorithm: "EdDSA",
      extractable: false,
      publicKey,
      metadata: { context: 0 },
    };

    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "ready" }));

    WithIdentitiesKeystore(mockProvider, mockOptions);

    // Give it some time
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockProvider.identity.store.addIdentity).not.toHaveBeenCalled();
  });

  it("should remove identity when key is removed", async () => {
    const publicKey = new Uint8Array(32).fill(1);
    const mockKey = {
      id: "key1",
      type: "hd-derived-ed25519",
      algorithm: "EdDSA",
      extractable: false,
      publicKey,
      metadata: { context: 1 },
    };

    // Initialize with the key
    keyStore.setState((s) => ({ ...s, keys: [mockKey], status: "ready" }));
    WithIdentitiesKeystore(mockProvider, mockOptions);

    await vi.waitFor(() => {
      expect(mockProvider.identity.store.addIdentity).toHaveBeenCalled();
    });

    // Mock the identity being in the store
    const identity = mockProvider.identity.store.addIdentity.mock.calls[0][0];
    identityStore.setState((s) => ({ ...s, identities: [identity] }));

    // Remove key
    keyStore.setState((s) => ({ ...s, keys: [], status: "ready" }));

    await vi.waitFor(() => {
      expect(mockProvider.identity.store.removeIdentity).toHaveBeenCalledWith(identity.address);
    });
  });

  it("should provide restoreFromDidDocument in the extension shape", () => {
    const extension = WithIdentitiesKeystore(mockProvider, mockOptions);
    expect(extension.identity.store.restoreFromDidDocument).toBeDefined();
  });

  describe("restoreFromDidDocument", () => {
    const ED25519_PREFIX = [0xed, 0x01];
    const P256_PREFIX = [0x80, 0x24];

    /** The public key the mocked `deriveFromSeed` re-derives for every child. */
    const derivedPublicKey = new Uint8Array(32).fill(7);

    /** The XHD (BIP32-Ed25519) root, parent of every ed25519 child. */
    const xhdRoot = {
      id: "root-1",
      type: "hd-root-key",
      algorithm: "raw",
      metadata: { rootKeyId: "seed-1" },
    };

    /** The deterministic-P256 main key, parent of every passkey. */
    const dp256Main = {
      id: "main-1",
      type: "hd-root-key",
      algorithm: "P256",
      metadata: { scheme: "pbkdf2-p256", rootKeyId: "seed-1" },
    };

    /** Encodes a public key the way a DID document verification method does. */
    const toMultibase = (publicKey: Uint8Array, prefix: number[] = ED25519_PREFIX) => {
      const prefixed = new Uint8Array(prefix.length + publicKey.length);
      prefixed.set(prefix);
      prefixed.set(publicKey, prefix.length);
      return `z${base58.encode(prefixed)}`;
    };

    const did = "did:key:zTestIdentity";

    const makeDoc = (verificationMethod: any[]): DIDDocument =>
      ({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: did,
        verificationMethod,
        authentication: [],
        assertionMethod: [],
        service: [],
      }) as unknown as DIDDocument;

    const accountVm = (metadata: Record<string, any>, publicKey = derivedPublicKey) => ({
      id: `${did}#account-key`,
      type: "Ed25519VerificationKey2020",
      controller: did,
      publicKeyMultibase: toMultibase(publicKey),
      metadata: {
        keyType: "hd-derived-ed25519",
        storage: "none",
        parentKeyId: "root-from-backup",
        path: "m/44'/283'/9'/0/9",
        derivation: 9,
        ...metadata,
      },
    });

    const setKeys = (keys: any[]) =>
      keyStore.setState((s) => ({ ...s, keys: keys as any, status: "ready" }));

    const addKey = (key: any) =>
      keyStore.setState((s) => ({ ...s, keys: [...(s.keys as any[]), key] as any }));

    beforeEach(() => {
      // Both roots are present and the P256 main key comes FIRST, so a naive
      // "first hd-root-key" lookup would pick the wrong parent.
      setKeys([dp256Main, xhdRoot]);

      mockProvider.key.store.deriveFromSeed = vi.fn(
        async (parentKeyId: string, path: string, opts: any) => {
          const id = opts?.id ?? `derived-${keyStore.state.keys.length}`;
          addKey({
            id,
            type: "hd-derived-ed25519",
            algorithm: "EdDSA",
            publicKey: derivedPublicKey,
            metadata: {
              storage: "none",
              parentKeyId,
              path,
              derivationType: 9,
              ...opts?.metadata,
            },
          });
          return id;
        },
      );

      mockProvider.key.store.deriveDomainKey = vi.fn(async (mainKeyId: string, opts: any) => {
        const id = opts?.id ?? `domain-${keyStore.state.keys.length}`;
        addKey({
          id,
          type: "hd-derived-p256",
          algorithm: "P256",
          publicKey: new Uint8Array(33).fill(8),
          metadata: {
            storage: "none",
            scheme: "pbkdf2-p256",
            parentKeyId: mainKeyId,
            origin: opts.origin,
            userHandle: opts.userHandle,
            counter: opts.counter,
            ...opts?.metadata,
          },
        });
        return id;
      });

      mockOptions.identities.keystore = { autoPopulate: false };
    });

    const restore = (doc: DIDDocument) =>
      (
        WithIdentitiesKeystore(mockProvider, mockOptions) as any
      ).identity.store.restoreFromDidDocument(doc);

    it("should throw when no root key is present", async () => {
      setKeys([]);
      await expect(restore(makeDoc([accountVm({ context: 0 })]))).rejects.toThrow(
        "No root key found in keystore. Recovery phrase must be imported first.",
      );
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();
    });

    it("should derive the context 0 account key from the XHD root and verify it", async () => {
      await restore(makeDoc([accountVm({ context: 0, account: 0, index: 0 })]));

      expect(mockProvider.key.store.deriveFromSeed).toHaveBeenCalledWith(
        "root-1",
        "m/44'/283'/0'/0/0",
        expect.objectContaining({ algorithm: "EdDSA", mode: "peikert" }),
      );
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();
    });

    it("should use the account/index from the document for the verification path", async () => {
      await restore(makeDoc([accountVm({ context: 0, account: 2, index: 5 })]));

      const [, path, options] = mockProvider.key.store.deriveFromSeed.mock.calls[0];
      expect(path).toBe("m/44'/283'/2'/0/5");
      expect(options.metadata).toMatchObject({ context: 0, account: 2, index: 5, derivation: 9 });
      // The backup's derivation coordinates must not overwrite the ones the
      // keystore computes for THIS wallet.
      expect(options.metadata.parentKeyId).toBeUndefined();
      expect(options.metadata.path).toBeUndefined();
      expect(options.metadata.keyType).toBeUndefined();
    });

    it("should throw when the derived public key does not match the document", async () => {
      const otherKey = new Uint8Array(32).fill(3);
      await expect(restore(makeDoc([accountVm({ context: 0 }, otherKey)]))).rejects.toThrow(
        "The recovery phrase does not match the backup file. Verification failed.",
      );
    });

    it("should derive context 1 identity keys along the identity BIP44 path", async () => {
      const identityVm = {
        id: `${did}#identity-key`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyMultibase: toMultibase(derivedPublicKey),
        metadata: {
          keyType: "hd-derived-ed25519",
          context: 1,
          account: 1,
          index: 3,
          derivation: 9,
          parentKeyId: "root-from-backup",
        },
      };

      await restore(makeDoc([identityVm]));

      expect(mockProvider.key.store.deriveFromSeed).toHaveBeenCalledWith(
        "root-1",
        "m/44'/0'/1'/0/3",
        expect.objectContaining({
          id: "identity-key",
          algorithm: "EdDSA",
          mode: "peikert",
          metadata: expect.objectContaining({
            context: 1,
            account: 1,
            index: 3,
            derivation: 9,
          }),
        }),
      );
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();

      // The restored record keeps the document's descriptor, which the `exists`
      // de-dup check and the identities store both match on.
      const restored = (keyStore.state.keys as any[]).find((k) => k.id === "identity-key");
      expect(restored.type).toBe("hd-derived-ed25519");
      expect(restored.metadata).toMatchObject({
        context: 1,
        account: 1,
        index: 3,
        derivation: 9,
        parentKeyId: "root-1",
      });
    });

    it("should default account and index to 0 when the document omits them", async () => {
      await restore(makeDoc([accountVm({ context: 1 })]));

      expect(mockProvider.key.store.deriveFromSeed).toHaveBeenCalledWith(
        "root-1",
        "m/44'/0'/0'/0/0",
        expect.anything(),
      );
    });

    it("should derive passkey entries from the pbkdf2-p256 main key", async () => {
      const passkeyVm = {
        id: `${did}#passkey-1`,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyMultibase: toMultibase(new Uint8Array(33).fill(8), P256_PREFIX),
        metadata: {
          keyType: "hd-derived-p256",
          origin: "https://example.com",
          userHandle: "user-handle",
          counter: 2,
          parentKeyId: "main-from-backup",
        },
      };

      await restore(makeDoc([passkeyVm]));

      expect(mockProvider.key.store.deriveDomainKey).toHaveBeenCalledWith(
        "main-1",
        expect.objectContaining({
          algorithm: "P256",
          id: "passkey-1",
          origin: "https://example.com",
          userHandle: "user-handle",
          counter: 2,
        }),
      );
      expect(mockProvider.key.store.deriveFromSeed).not.toHaveBeenCalled();
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();

      const restored = (keyStore.state.keys as any[]).find((k) => k.id === "passkey-1");
      expect(restored.type).toBe("hd-derived-p256");
      expect(restored.metadata).toMatchObject({ parentKeyId: "main-1", counter: 2 });
    });

    it("should default the passkey counter to 0", async () => {
      const passkeyVm = {
        id: `${did}#passkey-2`,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyMultibase: toMultibase(new Uint8Array(33).fill(8), P256_PREFIX),
        metadata: {
          keyType: "xhd-derived-p256",
          origin: "https://example.org",
          userHandle: "user-handle",
        },
      };

      await restore(makeDoc([passkeyVm]));

      expect(mockProvider.key.store.deriveDomainKey).toHaveBeenCalledWith(
        "main-1",
        expect.objectContaining({ counter: 0 }),
      );
    });

    it("should skip passkey entries when no pbkdf2-p256 main key exists", async () => {
      setKeys([xhdRoot]);
      const passkeyVm = {
        id: `${did}#passkey-3`,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyMultibase: toMultibase(new Uint8Array(33).fill(8), P256_PREFIX),
        metadata: {
          keyType: "hd-derived-p256",
          origin: "https://example.com",
          userHandle: "user-handle",
        },
      };

      await expect(restore(makeDoc([passkeyVm]))).resolves.toBeUndefined();
      expect(mockProvider.key.store.deriveDomainKey).not.toHaveBeenCalled();
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();
    });

    it("should never fall back to generate when the store cannot derive", async () => {
      delete mockProvider.key.store.deriveFromSeed;

      await expect(restore(makeDoc([accountVm({ context: 0 })]))).rejects.toThrow(/deriveFromSeed/);
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();
    });

    it("should not re-derive keys that already exist", async () => {
      const doc = makeDoc([accountVm({ context: 0, account: 0, index: 0 })]);
      await restore(doc);
      const callsAfterFirstRestore = mockProvider.key.store.deriveFromSeed.mock.calls.length;

      await restore(doc);
      expect(mockProvider.key.store.deriveFromSeed.mock.calls.length).toBe(
        callsAfterFirstRestore + 1,
      );
      expect(mockProvider.key.store.generate).not.toHaveBeenCalled();
    });
  });
});
