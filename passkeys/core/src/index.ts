/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/passkeys-core` is the platform-neutral **passkey
 * inventory store**: a reactive `@tanstack/store` `Store<PasskeysState>` of
 * the wallet's public passkey records (never private key material), the pure
 * store functions that drive it (`addPasskey`, `removePasskey`, `getPasskey`,
 * `getPasskeys`, `clearPasskeys`), and the pure server-reconciliation helpers
 * (`reconcilePasskeys`, `normalizeCredentialId`). The functions run standalone;
 * the {@link WithPasskeys} extension mounts them (with `before-after-hook`
 * hooks) at `provider.passkey.store` and the reactive `passkeys` getter on a
 * Wallet Provider.
 *
 * The store is the single seam **feeders** write through: the keystore bridge
 * (`@algorandfoundation/passkeys-keystore-extension`), the native feeder
 * (`@algorandfoundation/react-native-passkeys`) and the connections mirror
 * (`@algorandfoundation/passkeys-connections-extension`) all observe and write
 * the same store instance, and augment the `options.passkeys` namespace
 * ({@link PasskeysNamespace}) with their own fields.
 */

export * from "./extension.ts";
export * from "./reconcile.ts";
export * from "./store.ts";
export * from "./types.ts";
