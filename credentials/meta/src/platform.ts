import {
  DigitalCredentialsUnsupportedError,
  type DigitalCredentialGetResponse,
  type DigitalCredentialsPlatform,
} from "@algorandfoundation/credentials-core";

const REASON =
  "Node.js has no user-agent credential chooser; use the browser or React Native entry";

/**
 * Node implementation of the {@link DigitalCredentialsPlatform} contract.
 *
 * Node has no Digital Credentials user agent, so this is a permanent explicit
 * `unsupported` implementation: `isSupported()` returns `false` and
 * `get`/`create` reject with {@link DigitalCredentialsUnsupportedError}.
 *
 * @experimental The W3C Digital Credentials API is still a draft.
 */
export const nodeDigitalCredentials: DigitalCredentialsPlatform = {
  isSupported(): boolean {
    return false;
  },
  async get(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("node", REASON);
  },
  async create(): Promise<DigitalCredentialGetResponse> {
    throw new DigitalCredentialsUnsupportedError("node", REASON);
  },
};
