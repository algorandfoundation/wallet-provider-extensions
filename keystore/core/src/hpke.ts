/**
 * A minimal RFC 9180 (Hybrid Public Key Encryption) implementation covering
 * exactly what {@link import("./create.ts").KeyStore.encryptWithKey} needs:
 * **Auth mode** (`mode_auth`, `0x02`), **single-shot** seal/open, in the fixed
 * ciphersuite `DHKEM(P-256, HKDF-SHA256)` (`0x0010`) + `HKDF-SHA256` (`0x0001`)
 * + `AES-128-GCM` (`0x0001`).
 *
 * Every primitive runs through the **injected host {@link SubtleCrypto}**
 * (ECDH `deriveBits`, `HMAC` sign for HKDF-Extract/Expand, `AES-GCM`), never
 * through `globalThis.crypto`, so the module honours the keystore's
 * injected-host seam — the reason an off-the-shelf HPKE package (which
 * discovers the runtime WebCrypto itself) is not used here. Conformance is
 * pinned by the RFC 9180 Appendix A.3.3 test vectors in `hpke.test.ts`.
 */

/** Casts a `Uint8Array` to the DOM `BufferSource` the Subtle typings expect. */
function bs(view: Uint8Array): BufferSource {
  return view as unknown as BufferSource;
}

/** Concatenates byte arrays. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const utf8 = new TextEncoder();
const EMPTY = new Uint8Array(0);

/** `suite_id` = "HPKE" || kem_id (0x0010) || kdf_id (0x0001) || aead_id (0x0001). */
const SUITE_ID = concat(utf8.encode("HPKE"), new Uint8Array([0, 0x10, 0, 1, 0, 1]));
/** KEM `suite_id` = "KEM" || kem_id (0x0010). */
const KEM_SUITE_ID = concat(utf8.encode("KEM"), new Uint8Array([0, 0x10]));
/** RFC 9180 `mode_auth`. */
const MODE_AUTH = 0x02;
/** AES-128-GCM key length (`Nk`). */
const NK = 16;
/** AES-GCM nonce length (`Nn`). */
const NN = 12;
/** DHKEM(P-256) shared-secret length (`Nsecret`) and SHA-256 output length. */
const NSECRET = 32;
/** Uncompressed P-256 point length (`Npk` = `Nenc`). */
export const HPKE_P256_POINT_LENGTH = 65;

/** The WebCrypto algorithm of every asymmetric key this module touches. */
const P256: EcKeyImportParams = { name: "ECDH", namedCurve: "P-256" };

/**
 * `HMAC-SHA-256(key, data)` through the host Subtle — the primitive both
 * HKDF-Extract and HKDF-Expand reduce to. An empty `key` is replaced by
 * `HashLen` zero bytes exactly as RFC 5869 defines for an absent salt (and as
 * WebCrypto's own HKDF does internally).
 */
async function hmacSha256(
  host: SubtleCrypto,
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const hmacKey = await host.importKey(
    "raw",
    bs(key.byteLength === 0 ? new Uint8Array(NSECRET) : key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await host.sign("HMAC", hmacKey, bs(data)));
}

/** RFC 9180 `LabeledExtract(salt, label, ikm)` = `Extract(salt, "HPKE-v1" || suite_id || label || ikm)`. */
async function labeledExtract(
  host: SubtleCrypto,
  suiteId: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return hmacSha256(host, salt, concat(utf8.encode("HPKE-v1"), suiteId, utf8.encode(label), ikm));
}

/**
 * RFC 9180 `LabeledExpand(prk, label, info, L)` for `L <= HashLen`, which is
 * all this suite ever needs — a single HKDF-Expand block:
 * `T(1) = HMAC(prk, labeled_info || 0x01)`.
 */
async function labeledExpand(
  host: SubtleCrypto,
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const labeledInfo = concat(
    new Uint8Array([length >> 8, length & 0xff]),
    utf8.encode("HPKE-v1"),
    suiteId,
    utf8.encode(label),
    info,
    new Uint8Array([1]),
  );
  const block = await hmacSha256(host, prk, labeledInfo);
  return block.subarray(0, length);
}

/** Imports an uncompressed P-256 point as an ECDH public `CryptoKey`. */
async function importPublic(host: SubtleCrypto, point: Uint8Array): Promise<CryptoKey> {
  return host.importKey("raw", bs(point), P256, false, []);
}

/** Raw ECDH: the x-coordinate of `[privateKey]publicKey`, 32 bytes for P-256. */
async function dh(
  host: SubtleCrypto,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(
    await host.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256),
  );
}

/**
 * An ephemeral KEM key pair. Normally minted per seal inside
 * {@link hpkeSealAuth}; injectable only so the RFC 9180 test vectors (which
 * fix `skEm`) can drive the exact code path.
 */
export interface HpkeEphemeralKey {
  /** The ephemeral ECDH private key (`deriveBits`-capable). */
  privateKey: CryptoKey;
  /** The matching uncompressed public point (`enc`). */
  publicKey: Uint8Array;
}

/** Generates a fresh {@link HpkeEphemeralKey} through the host. */
async function generateEphemeral(host: SubtleCrypto): Promise<HpkeEphemeralKey> {
  const pair = (await host.generateKey(P256, false, ["deriveBits"])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(await host.exportKey("raw", pair.publicKey)),
  };
}

/**
 * RFC 9180 `AuthEncap`: combines an ephemeral-recipient and a static
 * sender-recipient ECDH into the KEM shared secret, returning it with the
 * encapsulated ephemeral public key (`enc`).
 */
async function authEncap(
  host: SubtleCrypto,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: CryptoKey,
  senderPublicKey: Uint8Array,
  ephemeralKey?: HpkeEphemeralKey,
): Promise<{ sharedSecret: Uint8Array; enc: Uint8Array }> {
  const pkR = await importPublic(host, recipientPublicKey);
  const ephemeral = ephemeralKey ?? (await generateEphemeral(host));
  const dhBytes = concat(
    await dh(host, ephemeral.privateKey, pkR),
    await dh(host, senderPrivateKey, pkR),
  );
  const kemContext = concat(ephemeral.publicKey, recipientPublicKey, senderPublicKey);
  const sharedSecret = await extractAndExpand(host, dhBytes, kemContext);
  dhBytes.fill(0);
  return { sharedSecret, enc: ephemeral.publicKey };
}

/** RFC 9180 `AuthDecap`: the recipient-side mirror of {@link authEncap}. */
async function authDecap(
  host: SubtleCrypto,
  enc: Uint8Array,
  recipientPrivateKey: CryptoKey,
  recipientPublicKey: Uint8Array,
  senderPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const pkE = await importPublic(host, enc);
  const pkS = await importPublic(host, senderPublicKey);
  const dhBytes = concat(
    await dh(host, recipientPrivateKey, pkE),
    await dh(host, recipientPrivateKey, pkS),
  );
  const kemContext = concat(enc, recipientPublicKey, senderPublicKey);
  const sharedSecret = await extractAndExpand(host, dhBytes, kemContext);
  dhBytes.fill(0);
  return sharedSecret;
}

/** RFC 9180 `ExtractAndExpand` for the KEM: `dh` -> `shared_secret`. */
async function extractAndExpand(
  host: SubtleCrypto,
  dhBytes: Uint8Array,
  kemContext: Uint8Array,
): Promise<Uint8Array> {
  const eaePrk = await labeledExtract(host, KEM_SUITE_ID, EMPTY, "eae_prk", dhBytes);
  return labeledExpand(host, KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, NSECRET);
}

/**
 * RFC 9180 `KeySchedule` for `mode_auth` without a PSK, reduced to the
 * single-shot needs: the AEAD key (imported straight into a non-extractable
 * `AES-GCM` `CryptoKey`) and `base_nonce` (the sequence-0 nonce).
 */
async function keySchedule(
  host: SubtleCrypto,
  sharedSecret: Uint8Array,
  info: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<{ aeadKey: CryptoKey; baseNonce: Uint8Array }> {
  const pskIdHash = await labeledExtract(host, SUITE_ID, EMPTY, "psk_id_hash", EMPTY);
  const infoHash = await labeledExtract(host, SUITE_ID, EMPTY, "info_hash", info);
  const context = concat(new Uint8Array([MODE_AUTH]), pskIdHash, infoHash);
  const secret = await labeledExtract(host, SUITE_ID, sharedSecret, "secret", EMPTY);
  const keyBytes = await labeledExpand(host, SUITE_ID, secret, "key", context, NK);
  const baseNonce = await labeledExpand(host, SUITE_ID, secret, "base_nonce", context, NN);
  secret.fill(0);
  const aeadKey = await host.importKey("raw", bs(keyBytes), { name: "AES-GCM" }, false, [usage]);
  keyBytes.fill(0);
  return { aeadKey, baseNonce };
}

/** Inputs for {@link hpkeSealAuth}. */
export interface HpkeSealOptions {
  /** The recipient's uncompressed P-256 public point (`pkRm`). */
  recipientPublicKey: Uint8Array;
  /** The sender's static ECDH private key (`skS`), `deriveBits`-capable. */
  senderPrivateKey: CryptoKey;
  /** The sender's uncompressed P-256 public point (`pkSm`). */
  senderPublicKey: Uint8Array;
  /** Application-supplied `info` binding the derived keys to their purpose. */
  info: Uint8Array;
  /** Additional authenticated data for the AEAD. */
  aad: Uint8Array;
  /** The plaintext to seal. */
  plaintext: Uint8Array;
  /** Test-vector injection only; omit in production so `enc` is fresh. */
  ephemeralKey?: HpkeEphemeralKey;
}

/**
 * Single-shot Auth-mode seal (`SealAuth`): encrypts `plaintext` so that only
 * the holder of the recipient private key can open it, and so that opening
 * also proves the sender held `senderPrivateKey`.
 *
 * @returns The encapsulated key (`enc`, 65 bytes) and the AEAD ciphertext.
 */
export async function hpkeSealAuth(
  host: SubtleCrypto,
  options: HpkeSealOptions,
): Promise<{ enc: Uint8Array; ciphertext: Uint8Array }> {
  const { sharedSecret, enc } = await authEncap(
    host,
    options.recipientPublicKey,
    options.senderPrivateKey,
    options.senderPublicKey,
    options.ephemeralKey,
  );
  const { aeadKey, baseNonce } = await keySchedule(host, sharedSecret, options.info, "encrypt");
  sharedSecret.fill(0);
  const ciphertext = new Uint8Array(
    await host.encrypt(
      { name: "AES-GCM", iv: bs(baseNonce), additionalData: bs(options.aad) },
      aeadKey,
      bs(options.plaintext),
    ),
  );
  return { enc, ciphertext };
}

/** Inputs for {@link hpkeOpenAuth}. */
export interface HpkeOpenOptions {
  /** The encapsulated ephemeral public key (`enc`) from the sealed message. */
  enc: Uint8Array;
  /** The recipient's static ECDH private key (`skR`), `deriveBits`-capable. */
  recipientPrivateKey: CryptoKey;
  /** The recipient's uncompressed P-256 public point (`pkRm`). */
  recipientPublicKey: Uint8Array;
  /** The sender's uncompressed P-256 public point (`pkSm`). */
  senderPublicKey: Uint8Array;
  /** The `info` value the sealer used. */
  info: Uint8Array;
  /** The additional authenticated data the sealer used. */
  aad: Uint8Array;
  /** The AEAD ciphertext to open. */
  ciphertext: Uint8Array;
}

/**
 * Single-shot Auth-mode open (`OpenAuth`): the inverse of
 * {@link hpkeSealAuth}. Fails (the host AEAD rejects) when the ciphertext was
 * not sealed to this recipient by the claimed sender, or when any input was
 * tampered with.
 *
 * @returns The recovered plaintext.
 */
export async function hpkeOpenAuth(
  host: SubtleCrypto,
  options: HpkeOpenOptions,
): Promise<Uint8Array> {
  const sharedSecret = await authDecap(
    host,
    options.enc,
    options.recipientPrivateKey,
    options.recipientPublicKey,
    options.senderPublicKey,
  );
  const { aeadKey, baseNonce } = await keySchedule(host, sharedSecret, options.info, "decrypt");
  sharedSecret.fill(0);
  return new Uint8Array(
    await host.decrypt(
      { name: "AES-GCM", iv: bs(baseNonce), additionalData: bs(options.aad) },
      aeadKey,
      bs(options.ciphertext),
    ),
  );
}
