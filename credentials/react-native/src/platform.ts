import {
  DigitalCredentialsUnsupportedError,
  type DigitalCredentialGetResponse,
  type DigitalCredentialsPlatform,
} from "@algorandfoundation/credentials-core";

const REASON =
  "the React Native Digital Credentials implementation has not landed yet; " +
  "Android Credential Manager (DigitalCredential) / iOS support is planned";

/**
 * React Native implementation of the {@link DigitalCredentialsPlatform}
 * contract.
 *
 * Currently an **explicit `unsupported` stub**: `isSupported()` returns
 * `false` and `get`/`create` reject with
 * {@link DigitalCredentialsUnsupportedError} — never a silent no-op.
 *
 * The real implementation will bridge to the platform credential managers —
 * Android's Credential Manager `DigitalCredential` API (and the registry APIs
 * for acting as a holder), with iOS following as Apple exposes an equivalent —
 * keeping this exact surface so applications do not change when support lands.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export const reactNativeDigitalCredentials: DigitalCredentialsPlatform = {
  isSupported(): boolean {
    return false;
  },
  async get(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("react-native", REASON);
  },
  async create(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("react-native", REASON);
  },
};
