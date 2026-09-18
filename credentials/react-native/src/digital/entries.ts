import type { RegisteredSdJwtCredential } from "./types.ts";

/**
 * The platform registry rejects entry ids longer than this.
 *
 * @example
 * ```typescript
 * if (entry.id.length > MAX_ENTRY_ID_LENGTH) throw new Error("entry id too long");
 * ```
 */
export const MAX_ENTRY_ID_LENGTH = 64;

/**
 * Validates registration entries before they are serialized for the native
 * registry, so obvious mistakes surface as JS errors instead of opaque
 * platform failures.
 *
 * @param entries - The SD-JWT VC entries about to be registered.
 * @throws Error when an entry has a missing or over-long `id`, a missing
 * `vct` or `title`, or a claim with an empty `path`.
 *
 * @example
 * ```typescript
 * validateEntries([
 *   {
 *     id: "credential-1",
 *     format: "dc+sd-jwt",
 *     vct: "https://credentials.example/identity",
 *     title: "Identity",
 *     claims: [{ path: ["given_name"], displayName: "Given name" }],
 *   },
 * ]);
 * ```
 */
export function validateEntries(entries: RegisteredSdJwtCredential[]): void {
  entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    if (typeof entry?.id !== "string" || entry.id.length === 0) {
      throw new Error(`${at}.id is required`);
    }
    if (entry.id.length > MAX_ENTRY_ID_LENGTH) {
      throw new Error(
        `${at}.id must be at most ${MAX_ENTRY_ID_LENGTH} characters (got ${entry.id.length})`,
      );
    }
    if (typeof entry.vct !== "string" || entry.vct.length === 0) {
      throw new Error(`${at}.vct is required`);
    }
    if (typeof entry.title !== "string" || entry.title.length === 0) {
      throw new Error(`${at}.title is required`);
    }
    const claims = entry.claims ?? [];
    claims.forEach((claim, claimIndex) => {
      if (!Array.isArray(claim?.path) || claim.path.length === 0) {
        throw new Error(`${at}.claims[${claimIndex}].path must be a non-empty array`);
      }
    });
  });
}
