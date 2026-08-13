import { describe, it, expect } from "vitest";
import {
  didKeyToJwk,
  didKeyVerificationMethod,
  encodeDidKey,
  jwkToDidKey,
  parseDidKey,
} from "./did-key.ts";

describe("did:key", () => {
  const ed25519Key = new Uint8Array(32).fill(7);

  it("round-trips encode → parse for Ed25519", () => {
    const did = encodeDidKey("Ed25519", ed25519Key);
    expect(did.startsWith("did:key:z6Mk")).toBe(true);

    const parsed = parseDidKey(did);
    expect(parsed.did).toBe(did);
    expect(parsed.curve).toBe("Ed25519");
    expect(parsed.kty).toBe("OKP");
    expect(parsed.publicKey).toEqual(ed25519Key);
  });

  it("round-trips encode → parse for P-256 (uncompressed)", () => {
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.fill(9, 1);
    const did = encodeDidKey("P-256", uncompressed);

    const parsed = parseDidKey(did);
    expect(parsed.curve).toBe("P-256");
    expect(parsed.kty).toBe("EC");
    expect(parsed.publicKey).toEqual(uncompressed);
  });

  it("strips fragments before parsing", () => {
    const did = encodeDidKey("Ed25519", ed25519Key);
    const parsed = parseDidKey(`${did}#${did.slice("did:key:".length)}`);
    expect(parsed.did).toBe(did);
  });

  it("builds the canonical verificationMethod id", () => {
    const did = encodeDidKey("Ed25519", ed25519Key);
    const multibase = did.slice("did:key:".length);
    expect(didKeyVerificationMethod(did)).toBe(`${did}#${multibase}`);
  });

  it("round-trips did:key ↔ JWK for OKP keys", () => {
    const did = encodeDidKey("Ed25519", ed25519Key);
    const jwk = didKeyToJwk(did);
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(jwkToDidKey(jwk)).toBe(did);
  });

  it("round-trips did:key ↔ JWK for EC keys", () => {
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.fill(3, 1, 33);
    uncompressed.fill(5, 33);
    const did = encodeDidKey("P-256", uncompressed);
    const jwk = didKeyToJwk(did);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(jwk.x).toBeDefined();
    expect(jwk.y).toBeDefined();
    expect(jwkToDidKey(jwk)).toBe(did);
  });

  it("rejects unsupported inputs", () => {
    expect(() => encodeDidKey("Curve448" as any, ed25519Key)).toThrow(/Unsupported did:key curve/);
    expect(() => parseDidKey("did:web:example.com")).toThrow(/Not a did:key/);
    expect(() => jwkToDidKey({ kty: "RSA", n: "...", e: "AQAB" })).toThrow(/Unsupported JWK shape/);
  });
});
