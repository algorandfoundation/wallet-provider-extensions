/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities-keystore-extension` bridges the identity
 * store (`@algorandfoundation/identities-core`) and the keystore
 * (`@algorandfoundation/keystore-core`). The {@link WithIdentitiesKeystore}
 * extension subscribes to the keystore's reactive store, turns every
 * identity-context (`metadata.context === 1`) `hd-derived-ed25519` key into a
 * `did:key` identity whose DID document projects the whole seed hierarchy, and
 * mounts `identity.store.restoreFromDidDocument` to re-derive keys from a
 * backed-up document. It reads `options.identities.keystore` (registered here
 * on the shared `IdentitiesNamespace`) and `options.keystore`.
 *
 * The bridge is Provider glue: it requires `WithIdentities` and a keystore
 * extension on the provider. The encoding helpers (`decodeAddress`,
 * `toBase64URL`, `fromUrlSafe`) are pure functions usable standalone.
 */

export * from "./extension.ts";
export * from "./types.ts";
export * from "./utils.ts";
