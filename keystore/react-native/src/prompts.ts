/**
 * Per-operation authentication prompt resolution.
 *
 * Every material-touching keystore call needs *some* wording for the platform
 * unlock dialog, but a host app rarely wants to pass one at every call site.
 * This module owns the single precedence chain used to pick that wording, so
 * the engine (which tags calls with their {@link AuthenticationOperation}) and
 * the Keychain helpers in `storage/crypto.ts` always agree.
 */

import type { Key, KeyId } from "@algorandfoundation/keystore-core";

import type {
  AuthenticationOperation,
  AuthenticationOptions,
  AuthenticationPrompt,
} from "./types.ts";

/**
 * Short, neutral built-in wording, used when the host configured nothing more
 * specific. Deliberately generic: an app that wants to name the key should use
 * {@link AuthenticationOptions.resolvePrompt}.
 */
const DEFAULT_PROMPTS: Record<AuthenticationOperation, string> = {
  generate: "Authenticate to generate a key",
  import: "Authenticate to import a key",
  importSeed: "Authenticate to import a seed",
  export: "Authenticate to export a key",
  sign: "Authenticate to sign",
  batchSign: "Authenticate to sign",
  deriveFromSeed: "Authenticate to derive a key",
  deriveDomainKey: "Authenticate to derive a key",
  deriveSharedSecret: "Authenticate to derive a shared secret",
  encryptWithKey: "Authenticate to encrypt",
  decryptWithKey: "Authenticate to decrypt",
  remove: "Authenticate to remove a key",
  clear: "Authenticate to remove all keys",
  "secret.put": "Authenticate to store a secret",
  "secret.get": "Authenticate to read a secret",
  "secret.remove": "Authenticate to remove a secret",
};

/** Wording used when not even the operation is known (direct driver-level reads). */
const FALLBACK_PROMPT = "Authenticate to secure your wallet";

/**
 * Normalizes the `string | AuthenticationPrompt` shorthand: a bare string
 * becomes `{ title }`.
 *
 * @param prompt - The configured prompt, if any.
 * @returns The prompt object to hand to `react-native-keychain`, falling back
 *   to a neutral title when nothing was configured.
 */
export function toAuthenticationPrompt(
  prompt: string | AuthenticationPrompt | undefined,
): AuthenticationPrompt {
  if (prompt === undefined) return { title: FALLBACK_PROMPT };
  return typeof prompt === "string" ? { title: prompt } : prompt;
}

/**
 * Resolves the prompt shown for one operation.
 *
 * Precedence, highest first:
 *  1. `context.prompt` — a prompt passed for *this* call; the caller asked for
 *     exactly this wording, so nothing may override it.
 *  2. `resolvePrompt(target)` — the host's formatter, which can name the key
 *     ("Sign with your Algorand account"). Returning `undefined` falls through.
 *  3. `prompts[operation]` — the host's per-operation map.
 *  4. `defaults.prompt` — the app-wide catch-all.
 *  5. A short built-in sentence for `operation`.
 *
 * The per-call `context` and the app-wide `defaults` are taken separately on
 * purpose: once they are merged, a caller-supplied `prompt` is
 * indistinguishable from the app-wide one, and steps 1 and 4 would collapse.
 *
 * @param context - The per-call authentication context, if the caller passed one.
 * @param defaults - The app-wide authentication policy from the engine options.
 * @param target - What is being unlocked: the operation, and the key it targets
 *   when there is one. `key` carries metadata only — never decrypt anything to
 *   build a prompt.
 * @returns The prompt object to pass to the Keychain call.
 */
export function resolveAuthenticationPrompt(
  context: AuthenticationOptions | undefined,
  defaults: AuthenticationOptions | undefined,
  target: { operation?: AuthenticationOperation; keyId?: KeyId; key?: Key },
): AuthenticationPrompt {
  if (context?.prompt !== undefined) return toAuthenticationPrompt(context.prompt);

  const operation = target.operation;
  if (operation === undefined) return toAuthenticationPrompt(defaults?.prompt);

  const formatter = context?.resolvePrompt ?? defaults?.resolvePrompt;
  const formatted = formatter?.({ operation, keyId: target.keyId, key: target.key });
  if (formatted !== undefined) return toAuthenticationPrompt(formatted);

  // Per-operation entries from the call context win over the app-wide map,
  // entry by entry, so a caller can override a single operation's wording.
  const mapped = context?.prompts?.[operation] ?? defaults?.prompts?.[operation];
  if (mapped !== undefined) return toAuthenticationPrompt(mapped);

  return toAuthenticationPrompt(defaults?.prompt ?? DEFAULT_PROMPTS[operation]);
}
