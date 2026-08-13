import { describe, it, expect, vi } from "vitest";
import Hook from "before-after-hook";
import { buildSignerFromHolder, identityHolderBinding } from "./holder.ts";
import { encodeDidKey } from "./utils/did-key.ts";

describe("buildSignerFromHolder", () => {
  it("returns undefined for holders without a sign callback", () => {
    expect(buildSignerFromHolder({ address: "watch-only" })).toBeUndefined();
  });

  it("derives alg, kid and JWK from a did:key holder", async () => {
    const publicKey = new Uint8Array(32).fill(7);
    const did = encodeDidKey("Ed25519", publicKey);
    const signer = buildSignerFromHolder({
      address: did,
      did,
      sign: async (data: Uint8Array[]) => data.map(() => new Uint8Array([1, 2, 3])),
    });

    expect(signer).toBeDefined();
    expect(signer!.alg).toBe("EdDSA");
    expect(signer!.kid).toBe(`${did}#${did.slice("did:key:".length)}`);
    expect(signer!.publicKeyJwk).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(await signer!.sign(new Uint8Array([0]))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("falls back to metadata.publicKeyJwk/kid when the address is not a did:key", () => {
    const publicKeyJwk = { kty: "OKP", crv: "Ed25519", x: "AAAA" };
    const signer = buildSignerFromHolder({
      address: "XHDADDRESS",
      metadata: { publicKeyJwk, kid: "custom-kid", alg: "ES256" },
      sign: async (data: Uint8Array[]) => data.map(() => new Uint8Array([9])),
    });

    expect(signer).toBeDefined();
    expect(signer!.alg).toBe("ES256");
    expect(signer!.kid).toBe("custom-kid");
    expect(signer!.publicKeyJwk).toEqual(publicKeyJwk);
  });

  it("throws when the holder signer returns no signature", async () => {
    const signer = buildSignerFromHolder({
      address: "XHDADDRESS",
      metadata: { publicKeyJwk: { kty: "OKP" } },
      sign: async () => [],
    });
    await expect(signer!.sign(new Uint8Array([0]))).rejects.toThrow(/no signature/);
  });
});

describe("identityHolderBinding", () => {
  it("resolves signers via getIdentity and undefined for unknown holders", async () => {
    const identities = new Map([
      [
        "holder-1",
        {
          address: "holder-1",
          metadata: { publicKeyJwk: { kty: "OKP" }, kid: "kid-1" },
          sign: async (data: Uint8Array[]) => data.map(() => new Uint8Array([1])),
        },
      ],
    ]);
    const binding = identityHolderBinding({
      hooks: new Hook.Collection<any>(),
      async getIdentity(address: string) {
        return identities.get(address);
      },
    });

    expect((await binding.getSigner("holder-1"))?.kid).toBe("kid-1");
    expect(await binding.getSigner("missing")).toBeUndefined();
  });

  it("invokes the evict callback with the removed holder's address", async () => {
    const hooks = new Hook.Collection<any>();
    const binding = identityHolderBinding({
      hooks,
      async getIdentity() {
        return undefined;
      },
    });
    const evict = vi.fn();
    binding.onRemoved!(evict);

    // Object-shaped and string-shaped remove params are both honoured.
    await hooks("remove", () => {}, { address: "did:key:z1" });
    await hooks("remove", () => {}, "did:key:z2" as any);
    // Params without an address are ignored.
    await hooks("remove", () => {}, {} as any);

    expect(evict).toHaveBeenCalledWith("did:key:z1");
    expect(evict).toHaveBeenCalledWith("did:key:z2");
    expect(evict).toHaveBeenCalledTimes(2);
  });
});
