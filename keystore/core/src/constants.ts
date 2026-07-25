export const context = "@algorandfoundation/keystore";

/**
 * The baseline set of standard WebCrypto algorithms the keystore relies on
 * directly from its **host** {@link SubtleCrypto} (as opposed to the composable
 * shim add-ons). These back the standard host key paths — `Ed25519` and generic
 * `ECDSA`/`ECDH`/`RSASSA-PKCS1-v1_5` keys — plus the `AES-GCM` used by
 * {@link import("./create.ts").KeyStore.encryptWithKey}.
 *
 * It is reported (tagged `source: "host"`) alongside the active shim algorithms
 * in {@link import("./types/extension.ts").KeyStoreState.algorithms}. Because
 * WebCrypto exposes no way to enumerate a host's real capabilities, this is a
 * documented baseline rather than a probe: a host that lacks one of these (e.g.
 * some React Native Subtle polyfills) may still list it. Platforms that want an
 * accurate list can override it via `createKeyStore`'s `hostAlgorithms` option.
 */
export const DEFAULT_HOST_ALGORITHMS = [
  "Ed25519",
  "ECDSA",
  "ECDH",
  "RSASSA-PKCS1-v1_5",
  "AES-GCM",
] as const;
