/**
 * Browser condition entry for `@algorandfoundation/credentials`.
 *
 * Resolved via the `browser` export condition; delegates to
 * `@algorandfoundation/credentials-web`, which re-exports the
 * platform-neutral core alongside the browser `WithCredentials` extension and
 * the browser Digital Credentials seam.
 */

export * from "@algorandfoundation/credentials-web";
