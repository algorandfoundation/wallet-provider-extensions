/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/identities-core` is the reactive identity store of the
 * identities domain: types (`Identity`, `DIDDocument`, `Service`), pure store
 * functions (`addIdentity`, `removeIdentity`, `getIdentity`,
 * `updateIdentityDidDocument`, `updateIdentityMetadata`, `clearIdentities`)
 * over a plain `@tanstack/store` `Store<IdentityStoreState>`, and the
 * `did:key` helpers (`generateDidKey`, `generateDidDocument`). Everything runs
 * **standalone**, no Provider required. The {@link WithIdentities} extension
 * mounts the same store on a Wallet Provider as the reactive `identities`
 * getter plus the `identity.store` API, reading `options.identities` (the
 * {@link IdentitiesNamespace} it registers on `ExtensionOptions`).
 *
 * This package is **store only**; the `@algorandfoundation/identities` meta
 * package exports a composed `WithIdentities` that adds the keystore and
 * connections bridges on top.
 */

export * from "./extension.ts";
export * from "./store.ts";
export * from "./types.ts";
export * from "./did-document.ts";
