/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities` is a thin **meta package** for the
 * identities domain. Its `package.json` `exports` map uses runtime/bundler
 * conditions (`react-native` / `browser` / `node`), mirroring
 * `@algorandfoundation/keystore` and `@algorandfoundation/credentials`.
 *
 * Today every condition resolves to the same platform-neutral composition:
 *
 * - `@algorandfoundation/identities-store` — the reactive identity store
 *   (`WithIdentityStore`, DID-document helpers, types), and
 * - `@algorandfoundation/identities-extension` — the unified `WithIdentities`
 *   extension that composes the store with the keystore bridge when a
 *   keystore is present on the provider.
 *
 * Per-platform identities packages (e.g. an mDoc-backed identity source via
 * the Digital Credentials API) will slot into the corresponding conditions
 * later without any application-facing change.
 */

export * from "@algorandfoundation/identities-store";
export * from "@algorandfoundation/identities-extension";
