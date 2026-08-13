import { describe, it, expect, vi } from "vitest";
import { Store } from "@tanstack/store";
import {
  decodeSignedTransaction,
  encodeTransaction,
  generateAddressWithSigners,
} from "@algorandfoundation/algokit-utils/transact";
import type { Transaction } from "@algorandfoundation/algokit-utils/transact";
import { encodeDidKey } from "@algorandfoundation/credentials-core";
import type { Identity, IdentityStoreState } from "@algorandfoundation/identities-store";
import type { IntermezzoClient } from "@algorandfoundation/intermezzo-client";
import { WithIntermezzoIdentities } from "./extension.ts";
import { createIdentityAlgorandSigner, signGroupForIdentity } from "./algorandSigner.ts";

const ED25519_PUBLIC_KEY = new Uint8Array(32).fill(7);
const DID = encodeDidKey("Ed25519", ED25519_PUBLIC_KEY);

/** Deterministic fake Ed25519 signature (correct length, no real crypto). */
const FAKE_SIGNATURE = new Uint8Array(64).fill(9);

function createIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    address: DID,
    type: "did:key",
    did: DID,
    sign: vi.fn(async (data: Uint8Array[]) => data.map(() => FAKE_SIGNATURE)),
    ...overrides,
  } as Identity;
}

function createProvider(identity: Identity = createIdentity()) {
  const identities = new Map<string, Identity>([[identity.address, identity]]);
  return {
    identity: {
      store: {
        async getIdentity(address: string) {
          return identities.get(address);
        },
      },
    },
    credential: { store: {} },
  } as any;
}

/** Builds a valid unsigned payment transaction, base64-encoded. */
function buildUnsignedTxnB64(): { txn: Transaction; b64: string } {
  const { addr } = generateAddressWithSigners({
    ed25519Pubkey: ED25519_PUBLIC_KEY,
    rawEd25519Signer: async () => FAKE_SIGNATURE,
  });
  const txn: Transaction = {
    type: "pay",
    sender: addr,
    payment: { receiver: addr, amount: 0n },
    fee: 1000n,
    firstValid: 1n,
    lastValid: 1000n,
    genesisHash: new Uint8Array(32),
    genesisId: "testnet-v1.0",
  } as Transaction;
  return { txn, b64: Buffer.from(encodeTransaction(txn)).toString("base64") };
}

describe("WithIntermezzoIdentities", () => {
  it("throws without the identities extension", () => {
    expect(() =>
      WithIntermezzoIdentities({ credential: { store: {} } } as any, {
        intermezzo: { baseUrl: "https://x" },
      }),
    ).toThrow(/requires WithIdentities/);
  });

  it("throws without the credentials extension", () => {
    const provider = createProvider();
    delete provider.credential;
    expect(() =>
      WithIntermezzoIdentities(provider, { intermezzo: { baseUrl: "https://x" } }),
    ).toThrow(/requires WithCredentials/);
  });

  it("throws without a baseUrl or pre-built client", () => {
    expect(() => WithIntermezzoIdentities(createProvider(), { intermezzo: {} as any })).toThrow(
      /requires options\.intermezzo\.baseUrl/,
    );
  });

  it("reuses an injected options.intermezzo.client and exposes the API", () => {
    const client = { getManagerIdentity: vi.fn() } as unknown as IntermezzoClient;
    const extension = WithIntermezzoIdentities(createProvider(), {
      intermezzo: { client } as any,
    });

    expect(extension.identity.intermezzo.client).toBe(client);
    expect(extension.identity.store).toBeDefined();
  });

  it("getAlgorandSigner derives the Algorand address from the identity's did:key", async () => {
    const client = {} as IntermezzoClient;
    const extension = WithIntermezzoIdentities(createProvider(), {
      intermezzo: { client } as any,
    });

    const signer = await extension.identity.intermezzo.getAlgorandSigner({
      identityAddress: DID,
    });

    const expected = generateAddressWithSigners({
      ed25519Pubkey: ED25519_PUBLIC_KEY,
      rawEd25519Signer: async () => FAKE_SIGNATURE,
    });
    expect(String(signer.addr)).toBe(String(expected.addr));

    await expect(
      extension.identity.intermezzo.getAlgorandSigner({ identityAddress: "unknown" }),
    ).rejects.toThrow(/unknown identity/);
  });

  it("anchorIdentity signs the wallet positions and records the anchor metadata", async () => {
    const { b64 } = buildUnsignedTxnB64();
    const client = {
      buildUserContractCreate: vi.fn().mockResolvedValue({
        didKey: DID,
        managerAddress: "MANAGER",
        userAddress: "USER",
        group: { txnGroup: [b64, b64], indexesToSign: [1] },
      }),
      submitUserContractCreate: vi.fn().mockResolvedValue({
        did: "did:algo:testnet:app:123",
        appId: "123",
        txId: "TX1",
      }),
    } as unknown as IntermezzoClient;

    const identity = createIdentity({ didDocument: { id: DID } as any });
    const identitiesStore = new Store<IdentityStoreState>({ identities: [identity] });
    const provider = createProvider(identity);
    const extension = WithIntermezzoIdentities(provider, {
      identities: { store: identitiesStore },
      intermezzo: { client } as any,
    });

    const result = await extension.identity.intermezzo.anchorIdentity({
      identityAddress: DID,
      credentialPresentation: "sd-jwt~kb",
    });

    // Wallet-signed group: null at unsigned positions, base64 at signed ones.
    const submitted = (client.submitUserContractCreate as any).mock.calls[0][0].signedTxns as (
      | string
      | null
    )[];
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toBeNull();
    expect(typeof submitted[1]).toBe("string");
    const signed = decodeSignedTransaction(
      new Uint8Array(Buffer.from(submitted[1] as string, "base64")),
    );
    expect(new Uint8Array(signed.sig!)).toEqual(FAKE_SIGNATURE);

    // The presentation header is forwarded on both calls.
    expect((client.buildUserContractCreate as any).mock.calls[0][0]).toEqual({
      credentialPresentation: "sd-jwt~kb",
    });
    expect((client.submitUserContractCreate as any).mock.calls[0][1]).toEqual({
      credentialPresentation: "sd-jwt~kb",
    });

    // The anchor snapshot lands in the identity's metadata.
    const anchored = identitiesStore.state.identities[0];
    expect(anchored.metadata?.anchor).toMatchObject({ didAlgo: "did:algo:testnet:app:123" });
    expect(result.submitResponse.did).toBe("did:algo:testnet:app:123");
    expect(String(result.signer.addr)).toBeTruthy();
  });
});

describe("createIdentityAlgorandSigner", () => {
  it("throws for identities without a sign callback", () => {
    expect(() => createIdentityAlgorandSigner(createIdentity({ sign: undefined }))).toThrow(
      /no sign callback/,
    );
  });

  it("throws for non-Ed25519 did:keys", () => {
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    const p256Did = encodeDidKey("P-256", uncompressed);
    expect(() =>
      createIdentityAlgorandSigner(createIdentity({ address: p256Did, did: p256Did })),
    ).toThrow(/only Ed25519 is supported/);
  });
});

describe("signGroupForIdentity", () => {
  it("signs only the indexesToSign positions and leaves the rest null", async () => {
    const { b64 } = buildUnsignedTxnB64();
    const identity = createIdentity();

    const out = await signGroupForIdentity(
      { txnGroup: [b64, b64, b64], indexesToSign: [0, 2] },
      identity,
    );

    expect(out).toHaveLength(3);
    expect(out[1]).toBeNull();
    for (const i of [0, 2]) {
      const signed = decodeSignedTransaction(
        new Uint8Array(Buffer.from(out[i] as string, "base64")),
      );
      expect(new Uint8Array(signed.sig!)).toEqual(FAKE_SIGNATURE);
    }
    // The two messages are signed in one batched call.
    expect(identity.sign).toHaveBeenCalledTimes(1);
  });
});
