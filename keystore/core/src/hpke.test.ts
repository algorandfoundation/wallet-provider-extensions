import { describe, expect, it } from "vitest";

import { type HpkeEphemeralKey, hpkeOpenAuth, hpkeSealAuth } from "./hpke.ts";

const subtle = globalThis.crypto.subtle;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Imports a raw P-256 private scalar as an ECDH `CryptoKey` via JWK, taking
 * the public coordinates from the matching uncompressed point.
 */
async function importPrivate(scalarHex: string, pointHex: string): Promise<CryptoKey> {
  const point = hexToBytes(pointHex);
  return subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64Url(hexToBytes(scalarHex)),
      x: base64Url(point.subarray(1, 33)),
      y: base64Url(point.subarray(33, 65)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  ) as Promise<CryptoKey>;
}

/**
 * RFC 9180 Appendix A.3.3 — DHKEM(P-256, HKDF-SHA256), HKDF-SHA256,
 * AES-128-GCM, Auth mode setup information and the sequence-0 encryption.
 */
const vector = {
  info: "4f6465206f6e2061204772656369616e2055726e",
  pkEm: "042224f3ea800f7ec55c03f29fc9865f6ee27004f818fcbdc6dc68932c1e52e15b79e264a98f2c535ef06745f3d308624414153b22c7332bc1e691cb4af4d53454",
  skEm: "6b8de0873aed0c1b2d09b8c7ed54cbf24fdf1dfc7a47fa501f918810642d7b91",
  pkRm: "04423e363e1cd54ce7b7573110ac121399acbc9ed815fae03b72ffbd4c18b01836835c5a09513f28fc971b7266cfde2e96afe84bb0f266920e82c4f53b36e1a78d",
  skRm: "d929ab4be2e59f6954d6bedd93e638f02d4046cef21115b00cdda2acb2a4440e",
  pkSm: "04a817a0902bf28e036d66add5d544cc3a0457eab150f104285df1e293b5c10eef8651213e43d9cd9086c80b309df22cf37609f58c1127f7607e85f210b2804f73",
  skSm: "1120ac99fb1fccc1e8230502d245719d1b217fe20505c7648795139d177f0de9",
  pt: "4265617574792069732074727574682c20747275746820626561757479",
  aad0: "436f756e742d30",
  ct0: "82ffc8c44760db691a07c5627e5fc2c08e7a86979ee79b494a17cc3405446ac2bdb8f265db4a099ed3289ffe19",
};

async function ephemeralFromVector(): Promise<HpkeEphemeralKey> {
  return {
    privateKey: await importPrivate(vector.skEm, vector.pkEm),
    publicKey: hexToBytes(vector.pkEm),
  };
}

describe("hpke (RFC 9180 A.3.3 — Auth mode, DHKEM(P-256), HKDF-SHA256, AES-128-GCM)", () => {
  it("seals to the exact RFC ciphertext with the vector's ephemeral key", async () => {
    const { enc, ciphertext } = await hpkeSealAuth(subtle, {
      recipientPublicKey: hexToBytes(vector.pkRm),
      senderPrivateKey: await importPrivate(vector.skSm, vector.pkSm),
      senderPublicKey: hexToBytes(vector.pkSm),
      info: hexToBytes(vector.info),
      aad: hexToBytes(vector.aad0),
      plaintext: hexToBytes(vector.pt),
      ephemeralKey: await ephemeralFromVector(),
    });
    expect(bytesToHex(enc)).toBe(vector.pkEm);
    expect(bytesToHex(ciphertext)).toBe(vector.ct0);
  });

  it("opens the RFC ciphertext with the recipient private key", async () => {
    const plaintext = await hpkeOpenAuth(subtle, {
      enc: hexToBytes(vector.pkEm),
      recipientPrivateKey: await importPrivate(vector.skRm, vector.pkRm),
      recipientPublicKey: hexToBytes(vector.pkRm),
      senderPublicKey: hexToBytes(vector.pkSm),
      info: hexToBytes(vector.info),
      aad: hexToBytes(vector.aad0),
      ciphertext: hexToBytes(vector.ct0),
    });
    expect(bytesToHex(plaintext)).toBe(vector.pt);
  });

  it("round-trips with a fresh ephemeral key and rejects a wrong sender claim", async () => {
    const recipientPrivateKey = await importPrivate(vector.skRm, vector.pkRm);
    const plaintext = new TextEncoder().encode("fresh ephemeral round-trip");
    const { enc, ciphertext } = await hpkeSealAuth(subtle, {
      recipientPublicKey: hexToBytes(vector.pkRm),
      senderPrivateKey: await importPrivate(vector.skSm, vector.pkSm),
      senderPublicKey: hexToBytes(vector.pkSm),
      info: hexToBytes(vector.info),
      aad: new Uint8Array(0),
      plaintext,
    });
    // A fresh ephemeral key must never repeat the vector's encapsulation.
    expect(bytesToHex(enc)).not.toBe(vector.pkEm);
    const opened = await hpkeOpenAuth(subtle, {
      enc,
      recipientPrivateKey,
      recipientPublicKey: hexToBytes(vector.pkRm),
      senderPublicKey: hexToBytes(vector.pkSm),
      info: hexToBytes(vector.info),
      aad: new Uint8Array(0),
      ciphertext,
    });
    expect(new TextDecoder().decode(opened)).toBe("fresh ephemeral round-trip");

    // Claiming a different sender (here: the ephemeral point) must fail auth.
    await expect(
      hpkeOpenAuth(subtle, {
        enc,
        recipientPrivateKey,
        recipientPublicKey: hexToBytes(vector.pkRm),
        senderPublicKey: hexToBytes(vector.pkEm),
        info: hexToBytes(vector.info),
        aad: new Uint8Array(0),
        ciphertext,
      }),
    ).rejects.toThrow();
  });
});
