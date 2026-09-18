/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/react-native-passkeys` is the React Native entry
 * point for the passkeys domain. The platform-neutral implementation
 * (the reactive passkey store, its pure store functions, and the server
 * reconciliation helpers) lives in
 * `@algorandfoundation/passkeys-core` and is re-exported here.
 *
 * @remarks
 * This package additionally ships the native **feeder** over
 * `@algorandfoundation/react-native-passkey-autofill`'s module:
 * {@link nativePasskeysFeeder} (with the key-material-stripping
 * {@link toPasskey} mapper) syncs the module's credentials into the
 * passkeys store, and the React Native `WithPasskeys` extension
 * composes it with the core extension and mounts the provider probes
 * (`providerActive`/`openProviderSettings`). It augments the shared
 * `options.passkeys` namespace with the injectable native `module`.
 */

export * from "@algorandfoundation/passkeys-core";
export {
  defaultPasskeyAutofillModule,
  nativePasskeysFeeder,
  toPasskey,
  type NativePasskeysFeeder,
  type NativePasskeysFeederOptions,
  type PasskeyAutofillCredentialIdentityLike,
  type PasskeyAutofillEventPayload,
  type PasskeyAutofillModuleLike,
} from "./feeder.ts";
export {
  WithPasskeys,
  type ReactNativePasskeysExtension,
  type ReactNativePasskeysOptions,
} from "./extension.ts";
