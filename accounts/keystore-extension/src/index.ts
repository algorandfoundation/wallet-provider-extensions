/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/accounts-keystore-extension` is the **reference**
 * bridge between the accounts store and the keystore. The
 * {@link WithAccountsKeystore} extension subscribes to the keystore's reactive
 * store and mirrors every account-producing key (`hd-derived-ed25519`,
 * `ed25519`, `falcon-1024`) into the shared accounts store as a
 * {@link KeystoreAccount} whose `sign` delegates to the keystore backend.
 * Accounts are keyed by the base64 of the public key; concrete chain
 * addressing lives in `@algorandfoundation/algorand-accounts-extension`.
 *
 * The bridge augments the core `options.accounts` namespace with a
 * `keystore` block ({@link AccountsKeystoreNamespace}) and contributes no
 * provider surface of its own. It is Provider glue by design: both stores it
 * connects run standalone, and the sync it implements is exactly what a
 * standalone integration would replicate with the accounts-core functions.
 */

export * from "./extension.ts";
export * from "./types.ts";
