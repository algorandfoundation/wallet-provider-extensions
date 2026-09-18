/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/passkeys-keystore-extension` is the **bridge** between
 * the passkeys store (`@algorandfoundation/passkeys-core`) and the keystore
 * (`@algorandfoundation/keystore-core`). Its {@link WithPasskeysKeystore}
 * extension mirrors the keystore's derived P256 domain keys (the keys
 * `deriveDomainKey` mints for WebAuthn credentials) into the passkeys store as
 * public-only records, refreshes them when the key's metadata changes, and
 * propagates the removal of a bridge-owned passkey back to the keystore.
 *
 * The bridge is Provider glue by design: it requires `WithPasskeys` and a
 * keystore extension on the provider, reads the shared stores from
 * `options.passkeys.store` / `options.keystore.store`, and registers the
 * `options.passkeys.keystore` block ({@link PasskeysKeystoreNamespace}) on the
 * shared passkeys namespace.
 */

export * from "./extension.ts";
export * from "./types.ts";
