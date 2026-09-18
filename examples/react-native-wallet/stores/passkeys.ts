import { Store } from "@tanstack/store";
import type { PasskeysState } from "@algorandfoundation/passkeys-core";

/**
 * The single source of truth for the passkeys held by this device's
 * credential provider (`react-native-passkey-autofill`). The passkeys
 * engine reads the provider's MMKV-backed store through the native
 * module and mirrors it here: the same entries the Android
 * `CredentialProviderService` serves to `navigator.credentials.get`,
 * with the private key material never crossing into JS.
 */
export const passkeysStore = new Store<PasskeysState>({
  passkeys: [],
});
