/**
 * Pure reconciliation helpers: comparing the local passkey inventory
 * against the WebAuthn request options a relying party's server hands
 * out (its `allowCredentials` list is the truth for which credentials
 * it still knows).
 */

import type { Passkey, WebAuthnRequestOptionsLike } from "./types.ts";

/** The base64url alphabet, indexed by 6-bit value. */
const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encodes raw bytes as base64url without padding. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_URL_ALPHABET[b0 >> 2];
    out += BASE64_URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += BASE64_URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += BASE64_URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Normalizes a WebAuthn credential id to base64url without padding.
 *
 * Strings are assumed to already be base64(url): padding is stripped
 * and the standard-alphabet characters `+`/`/` are tolerated (mapped to
 * `-`/`_`). Raw bytes (`Uint8Array`/`ArrayBuffer`) are encoded.
 *
 * @param id - The credential id in any of its wire shapes.
 * @returns The base64url (unpadded) form.
 *
 * @example
 * ```typescript
 * normalizeCredentialId("q2Zt+a/b=="); // "q2Zt-a_b"
 * normalizeCredentialId(new Uint8Array([1, 2, 3])); // "AQID"
 * ```
 */
export function normalizeCredentialId(id: string | Uint8Array | ArrayBuffer): string {
  if (typeof id === "string") {
    return id.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const bytes = id instanceof Uint8Array ? id : new Uint8Array(id);
  return bytesToBase64Url(bytes);
}

/**
 * The result of a {@link reconcilePasskeys} pass.
 *
 * @example
 * ```typescript
 * const { known, strays, missing } = reconcilePasskeys(local, serverOptions);
 * if (strays.length) console.warn("server forgot", strays.map((p) => p.credentialId));
 * ```
 */
export interface ReconcileResult {
  /** The full local list with reconciled `serverStatus`/`reconciledAt` applied. */
  passkeys: Passkey[];
  /** In-scope passkeys the server listed in `allowCredentials`. */
  known: Passkey[];
  /** In-scope passkeys the server did NOT list (local strays). */
  strays: Passkey[];
  /**
   * Normalized `allowCredentials` ids with no local match: credentials
   * the server expects but this device does not hold.
   */
  missing: string[];
}

/** Extracts the hostname of an origin string, tolerating bare hosts. */
function originHost(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/**
 * Reconciles the local passkey inventory against server-provided
 * WebAuthn request options.
 *
 * The server's options are the truth for the `rpId` in scope: a local
 * passkey is **in scope** when `options.rpId` is absent OR it matches
 * `passkey.rpId` (or the host of `passkey.origin`). In-scope passkeys
 * whose normalized credential id appears in `allowCredentials` become
 * `serverStatus: "known"`; in-scope ones the server did not list become
 * `serverStatus: "unknown"` (strays), so an empty/absent
 * `allowCredentials` with an `rpId` marks every in-scope passkey
 * `unknown`. Ids in `allowCredentials` with no local match are returned
 * in `missing`. Out-of-scope passkeys pass through untouched.
 *
 * @param local - The local passkey inventory.
 * @param options - The server's {@link WebAuthnRequestOptionsLike}.
 * @param now - The `reconciledAt` timestamp; defaults to `Date.now()`.
 * @returns The {@link ReconcileResult}.
 *
 * @example
 * ```typescript
 * const result = reconcilePasskeys(store.state.passkeys, {
 *   rpId: "example.com",
 *   allowCredentials: [{ id: "q2Zt..." }],
 * });
 * store.setState((state) => ({ ...state, passkeys: result.passkeys }));
 * ```
 */
export function reconcilePasskeys(
  local: Passkey[],
  options: WebAuthnRequestOptionsLike,
  now?: number,
): ReconcileResult {
  const reconciledAt = now ?? Date.now();
  const allowedIds = (options.allowCredentials ?? []).map((c) => normalizeCredentialId(c.id));
  const allowed = new Set(allowedIds);
  const rpId = options.rpId;

  const inScope = (passkey: Passkey): boolean =>
    !rpId || passkey.rpId === rpId || originHost(passkey.origin) === rpId;

  const known: Passkey[] = [];
  const strays: Passkey[] = [];
  const matched = new Set<string>();

  const passkeys = local.map((passkey) => {
    if (!inScope(passkey)) return passkey;
    const normalizedId = normalizeCredentialId(passkey.credentialId);
    if (allowed.has(normalizedId)) {
      matched.add(normalizedId);
      const reconciled: Passkey = { ...passkey, serverStatus: "known", reconciledAt };
      known.push(reconciled);
      return reconciled;
    }
    const reconciled: Passkey = { ...passkey, serverStatus: "unknown", reconciledAt };
    strays.push(reconciled);
    return reconciled;
  });

  const missing: string[] = [];
  for (const id of allowedIds) {
    if (!matched.has(id) && !missing.includes(id)) missing.push(id);
  }

  return { passkeys, known, strays, missing };
}
