import {
  DigitalCredentialsUnsupportedError,
  type DigitalCredentialGetResponse,
  type DigitalCredentialsPlatform,
} from "@algorandfoundation/credentials-core";

const REASON =
  "the browser Digital Credentials implementation has not landed yet; " +
  "navigator.credentials.get({ digital }) support is planned";

/**
 * Browser implementation of the {@link DigitalCredentialsPlatform} contract.
 *
 * Currently an **explicit `unsupported` stub**: `isSupported()` returns
 * `false` and `get`/`create` reject with
 * {@link DigitalCredentialsUnsupportedError} — never a silent no-op.
 *
 * The real implementation will feature-detect
 * `navigator.credentials.get({ digital: { requests } })` (and its `create`
 * counterpart) and forward the W3C-shaped requests to the user agent, keeping
 * this exact surface so applications do not change when support lands.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export const webDigitalCredentials: DigitalCredentialsPlatform = {
  isSupported(): boolean {
    return false;
  },
  async get(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("web", REASON);
  },
  async create(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("web", REASON);
  },
};
