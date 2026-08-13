/**
 * Minimal asymmetric signer abstraction used by the credential utilities
 * to produce JWS signatures (JWT, SD-JWT key-binding JWT, OID4VP VP token).
 *
 * The concrete implementation typically wraps a `did:key` private key
 * held in the native keystore. Bridging to a Credo `Wallet` /
 * `KeyManagementService` is intentionally trivial: implement `sign` with
 * `agent.wallet.sign({ data, key })` and return the raw signature bytes.
 *
 * @example
 * ```typescript
 * const signer: JwsSigner = {
 *   alg: 'EdDSA',
 *   kid: 'did:key:z6Mk...#z6Mk...',
 *   publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: '...' },
 *   async sign(data) {
 *     return keystore.sign(privateKeyHandle, data);
 *   },
 * };
 * ```
 */
export interface JwsSigner {
  /** JOSE `alg` value (e.g. `EdDSA`, `ES256`). */
  alg: string;
  /** Optional `kid` to embed in the JWS header (typically the did:key URL). */
  kid?: string;
  /** Public key in JWK form, used to populate `cnf.jwk` / `jwk` headers. */
  publicKeyJwk: JsonWebKey;
  /** Signs the JWS signing input (`<header>.<payload>`) and returns the raw signature. */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Minimal JSON Web Key shape covering the curves used by `did:key`
 * (Ed25519 and P-256). Re-declared here to avoid a `lib.dom` dependency
 * in non-DOM call sites.
 */
export interface JsonWebKey {
  kty: "OKP" | "EC" | "RSA" | (string & {});
  crv?: "Ed25519" | "X25519" | "P-256" | "P-384" | "P-521" | (string & {});
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  kid?: string;
}
