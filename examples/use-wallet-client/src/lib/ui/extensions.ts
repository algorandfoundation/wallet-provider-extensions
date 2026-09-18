/**
 * Extension adoption inference: the Provider determines what the page
 * renders.
 *
 * Every wallet-provider extension installs its namespaced API onto the
 * Provider instance inside the constructor (`WithConnections` →
 * `connection`, `WithAccounts` → `account`, `WithIdentities` →
 * `identity`, `WithCredentials` → `credential`, `WithPasskeys` →
 * `passkey`, `WithKeyStore` → `key`). The presence of that namespace is
 * therefore runtime evidence the extension has actually been ADOPTED
 * (not just declared), so the page infers capabilities off the instance
 * itself instead of hard-coding them. Informal by design: a provider
 * discovery spec (see wallet-provider's DISCOVERY.md) will formalize
 * capability negotiation later.
 */

/** The namespaced API each known extension installs on a Provider instance. */
export const EXTENSION_NAMESPACES = {
  WithConnections: "connection",
  WithAccounts: "account",
  WithIdentities: "identity",
  WithCredentials: "credential",
  WithPasskeys: "passkey",
  WithKeyStore: "key",
} as const;

/** A wallet-provider extension this demo knows how to render a domain for. */
export type KnownExtension = keyof typeof EXTENSION_NAMESPACES;

/**
 * Infers which known extensions the given Provider instance has adopted
 * by probing for the namespaced API each one installs. Extensions apply
 * once in the Provider constructor and never change afterwards, so one
 * probe per instance is enough.
 */
export function adoptedExtensions(provider: object): ReadonlySet<KnownExtension> {
  const record = provider as Record<string, unknown>;
  const adopted = new Set<KnownExtension>();
  for (const [extension, namespace] of Object.entries(EXTENSION_NAMESPACES)) {
    if (record[namespace] != null) adopted.add(extension as KnownExtension);
  }
  return adopted;
}
