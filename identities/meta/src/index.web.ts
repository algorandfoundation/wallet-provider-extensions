/**
 * Browser condition entry for `@algorandfoundation/identities`.
 *
 * Resolved via the `browser` export condition. Currently identical to the
 * platform-neutral composition (store + unified `WithIdentities`); a browser
 * identities package will replace this delegation when a real platform seam
 * lands.
 */

export * from "@algorandfoundation/identities-store";
export * from "@algorandfoundation/identities-extension";
