import { base58 } from "@scure/base";
import { base64UrlDecode, base64UrlEncode } from "./base64.ts";
import type { JsonWebKey } from "./signer.ts";

/**
 * Multicodec prefixes for the curves we care about in OID4VC flows.
 *
 * @see https://github.com/multiformats/multicodec/blob/master/table.csv
 */
const MULTICODEC_PREFIX: Record<string, Uint8Array> = {
  Ed25519: new Uint8Array([0xed, 0x01]),
  X25519: new Uint8Array([0xec, 0x01]),
  "P-256": new Uint8Array([0x80, 0x24]),
  "P-384": new Uint8Array([0x81, 0x24]),
  Secp256k1: new Uint8Array([0xe7, 0x01]),
};

const PREFIX_TO_CURVE: Array<{ prefix: Uint8Array; crv: string; kty: "OKP" | "EC" }> = [
  { prefix: MULTICODEC_PREFIX.Ed25519, crv: "Ed25519", kty: "OKP" },
  { prefix: MULTICODEC_PREFIX.X25519, crv: "X25519", kty: "OKP" },
  { prefix: MULTICODEC_PREFIX["P-256"], crv: "P-256", kty: "EC" },
  { prefix: MULTICODEC_PREFIX["P-384"], crv: "P-384", kty: "EC" },
  { prefix: MULTICODEC_PREFIX.Secp256k1, crv: "secp256k1", kty: "EC" },
];

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Encodes a raw public key into a `did:key` identifier using the
 * multicodec / multibase-base58btc scheme.
 *
 * The wallet's `did:key` is what gets pinned into OID4VCI offers
 * (`holderDidKey`) and re-derived on the issuer side from the holder
 * proof. See SEQUENCE.md §3 and §4a.
 *
 * @example
 * ```typescript
 * const did = encodeDidKey('Ed25519', ed25519PublicKey);
 * // did:key:z6Mk...
 * ```
 */
export function encodeDidKey(curve: keyof typeof MULTICODEC_PREFIX, publicKey: Uint8Array): string {
  const prefix = MULTICODEC_PREFIX[curve];
  if (!prefix) {
    throw new Error(`Unsupported did:key curve: ${curve}`);
  }
  const multikey = concatBytes(prefix, publicKey);
  return `did:key:z${base58.encode(multikey)}`;
}

/**
 * Parses a `did:key` identifier back into its curve + raw public key.
 *
 * Throws if the multibase prefix is unsupported or the curve is unknown.
 */
export function parseDidKey(did: string): {
  did: string;
  multibase: string;
  curve: string;
  kty: "OKP" | "EC";
  publicKey: Uint8Array;
} {
  const trimmed = did.split("#")[0];
  if (!trimmed.startsWith("did:key:z")) {
    throw new Error(`Not a did:key (or unsupported multibase): ${did}`);
  }
  const multibase = trimmed.slice("did:key:".length);
  const bytes = base58.decode(multibase.slice(1));

  for (const { prefix, crv, kty } of PREFIX_TO_CURVE) {
    if (bytes.length > prefix.length && bytes[0] === prefix[0] && bytes[1] === prefix[1]) {
      return {
        did: trimmed,
        multibase,
        curve: crv,
        kty,
        publicKey: bytes.slice(prefix.length),
      };
    }
  }
  throw new Error(
    `Unsupported did:key multicodec prefix: 0x${bytes[0]?.toString(16)}${bytes[1]?.toString(16)}`,
  );
}

/**
 * Returns the canonical verificationMethod id for a `did:key`, i.e.
 * `did:key:z...#z...` — the value typically used as a JWS `kid`.
 */
export function didKeyVerificationMethod(did: string): string {
  const parsed = parseDidKey(did);
  return `${parsed.did}#${parsed.multibase}`;
}

/**
 * Converts a parsed `did:key` (or directly a curve + public key) into a
 * JWK suitable for use as the JOSE `jwk` header or SD-JWT `cnf.jwk`.
 *
 * Only the curves supported by {@link encodeDidKey} are accepted.
 * For `EC` curves the public key is expected in uncompressed form
 * (`0x04 || X || Y`) — compressed-point decoding requires a curve
 * library and is out of scope here.
 */
export function didKeyToJwk(did: string): JsonWebKey {
  const { curve, kty, publicKey } = parseDidKey(did);
  if (kty === "OKP") {
    return {
      kty: "OKP",
      crv: curve,
      x: base64UrlEncode(publicKey),
    };
  }
  if (publicKey[0] !== 0x04) {
    throw new Error("Only uncompressed EC public keys are supported when converting did:key → JWK");
  }
  const half = (publicKey.length - 1) / 2;
  return {
    kty: "EC",
    crv: curve,
    x: base64UrlEncode(publicKey.slice(1, 1 + half)),
    y: base64UrlEncode(publicKey.slice(1 + half)),
  };
}

/**
 * Builds a `did:key` from a JWK. Mirror of {@link didKeyToJwk}.
 */
export function jwkToDidKey(jwk: JsonWebKey): string {
  if (jwk.kty === "OKP" && jwk.crv && jwk.x) {
    return encodeDidKey(jwk.crv as keyof typeof MULTICODEC_PREFIX, base64UrlDecode(jwk.x));
  }
  if (jwk.kty === "EC" && jwk.crv && jwk.x && jwk.y) {
    const x = base64UrlDecode(jwk.x);
    const y = base64UrlDecode(jwk.y);
    const uncompressed = concatBytes(new Uint8Array([0x04]), x, y);
    return encodeDidKey(jwk.crv as keyof typeof MULTICODEC_PREFIX, uncompressed);
  }
  throw new Error("Unsupported JWK shape for did:key encoding");
}
