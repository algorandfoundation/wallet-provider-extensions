/**
 * The JS binding of the Digital Credentials expo native module this package
 * ships (Android Credential Manager registry under `android/`, an explicit
 * "unsupported" stub under `ios/`).
 *
 * ⚠️ Importing this file **requires the native module to be present**;
 * `requireNativeModule` throws otherwise. It is therefore *not* re-exported
 * from the package root: `provider.ts` resolves it lazily through
 * `defaultDigitalCredentialsModule()`, so the package stays importable in
 * plain Node (tests, tooling) where no native runtime exists.
 */

import { NativeModule, requireNativeModule } from "expo";

import { validateEntries } from "./entries.ts";
import type {
  ReactNativeDigitalCredentialsModuleEvents,
  RegisteredSdJwtCredential,
} from "./types.ts";

declare class ReactNativeDigitalCredentialsModule extends NativeModule<ReactNativeDigitalCredentialsModuleEvents> {
  /**
   * Whether the platform credential-provider registry is available
   * (Android 9+ with Google Play services; always `false` on iOS).
   */
  isSupported(): boolean;
  /**
   * Publishes (replacing any previous set) the credentials this wallet can
   * present. `entriesJson` is `JSON.stringify(RegisteredSdJwtCredential[])`.
   */
  registerCredentials(entriesJson: string): Promise<void>;
  /** Removes every entry this app registered with the platform registry. */
  unregisterCredentials(): Promise<void>;
  /**
   * Hands the protocol response back to the platform, closing the flow
   * started by an `onPresentationRequest` event. `responseJson` is
   * `{"protocol": string, "data": object}`.
   */
  completePresentationRequest(requestId: string, responseJson: string): void;
  /** Aborts the platform flow with a human-readable message. */
  abortPresentationRequest(requestId: string, message: string): void;
}

// This call loads the native module object from the JSI.
const nativeModule: ReactNativeDigitalCredentialsModule =
  requireNativeModule<ReactNativeDigitalCredentialsModule>("ReactNativeDigitalCredentials");

// `registerCredentials` crosses the bridge as a JSON string (the platform
// registry wants one blob), so the entries are validated here, on the JS
// side of the boundary, to turn typos into readable errors instead of
// opaque registry failures.
const registerCredentials = nativeModule.registerCredentials.bind(nativeModule);
nativeModule.registerCredentials = (entriesJson: string): Promise<void> => {
  let entries: RegisteredSdJwtCredential[];
  try {
    entries = JSON.parse(entriesJson) as RegisteredSdJwtCredential[];
  } catch {
    return Promise.reject(new Error("registerCredentials: entriesJson is not valid JSON"));
  }
  if (!Array.isArray(entries)) {
    return Promise.reject(new Error("registerCredentials: entriesJson must be a JSON array"));
  }
  try {
    validateEntries(entries);
  } catch (error) {
    return Promise.reject(error as Error);
  }
  return registerCredentials(entriesJson);
};

export default nativeModule;
