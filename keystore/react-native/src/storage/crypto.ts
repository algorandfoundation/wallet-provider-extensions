import { base64 } from "@scure/base";
import * as Keychain from "react-native-keychain";
import { randomBytes } from "react-native-quick-crypto";
import { MasterKeyNotFoundError, UnlockingError } from "../errors.ts";
import { resolveAuthenticationPrompt } from "../prompts.ts";
import type { AuthenticationOptions } from "../types.ts";

/** AES-GCM IV length in bytes (96-bit, the recommended GCM nonce size). */
const IV_LENGTH = 12;

/**
 * This module deliberately keeps **no** in-process copy of the master key.
 *
 * An earlier revision cached it in a module-level `Buffer` for 60 seconds to
 * avoid prompt spam. That defeated the point of the whole design: the one key
 * that decrypts everything at rest sat in plaintext JS memory, reachable by
 * any code in the bundle and by anything that can read the heap, for a full
 * minute after each unlock. The driver already reads → uses → wipes the key
 * per operation, and prompt spam is now prevented at the OS level by
 * {@link AuthenticationOptions.authenticationValidityDuration}, i.e. by the
 * platform's own post-unlock reuse window, which never exposes the bytes.
 */

/** Casts a `Uint8Array` to the strict `BufferSource` overload WebCrypto expects. */
function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

// The installed `react-native-keychain@10.0.0` types do not declare
// `authenticationValidityDuration` yet; it is added by the pnpm patch at
// `patches/react-native-keychain@10.0.0.patch`. These narrow local aliases keep
// the option type-checked (a number) without reaching for `any`, and can be
// deleted once the patched typings ship.
type PatchedGetOptions = Keychain.GetOptions & { authenticationValidityDuration?: number };
type PatchedSetOptions = Keychain.SetOptions & { authenticationValidityDuration?: number };

/**
 * Reads the existing master key from the Keychain.
 *
 * This never creates a replacement key. A falsey Keychain result can mean
 * either "missing" or "failed to read"; callers must decide whether creation
 * is safe for their current storage state.
 *
 * @returns The master key as a Buffer
 */
export async function readMasterKey(options?: AuthenticationOptions): Promise<Buffer> {
  const getOptions: PatchedGetOptions = {
    service: "app-secret",
    authenticationPrompt: resolveAuthenticationPrompt(options, undefined, {
      operation: options?.operation,
      keyId: options?.keyId,
    }),
  };
  if (options?.authenticationValidityDuration !== undefined) {
    getOptions.authenticationValidityDuration = options.authenticationValidityDuration;
  }

  const credentials = await Keychain.getGenericPassword(getOptions);
  if (credentials) return Buffer.from(credentials.password, "hex");

  throw new MasterKeyNotFoundError();
}

/**
 * Creates and stores a new master key.
 *
 * Only call this from explicit initialization paths where there are no
 * encrypted keystore records that depend on a previous master key.
 *
 * @returns The newly created master key as a Buffer
 */
export async function createMasterKey(options?: AuthenticationOptions): Promise<Buffer> {
  const biometricOptions = options?.biometrics
    ? {
        // BIOMETRY_CURRENT_SET binds the item to the biometric set enrolled
        // right now, so enrolling a new finger/face invalidates it — strictly
        // safer, but destructive for legitimate re-enrolment, hence opt-in.
        accessControl: options.invalidateOnEnrollment
          ? Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET
          : Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        authenticationPrompt: resolveAuthenticationPrompt(options, undefined, {
          operation: options.operation,
          keyId: options.keyId,
        }),
      }
    : {};

  const setOptions: PatchedSetOptions = {
    service: "app-secret",
    ...biometricOptions,
  };
  // On Android this value is baked into the Keystore key here, at creation
  // time; on iOS it only matters per read. Forward it on both paths.
  if (options?.authenticationValidityDuration !== undefined) {
    setOptions.authenticationValidityDuration = options.authenticationValidityDuration;
  }

  const newKey = Buffer.from(randomBytes(32)); // TODO: harden entropy
  const result = await Keychain.setGenericPassword("master", newKey.toString("hex"), setOptions);
  if (!result) {
    throw new UnlockingError("Failed to store master key");
  }

  return Buffer.from(newKey);
}

/**
 * Seals `data` at rest using the host {@link SubtleCrypto} AES-256-GCM, the
 * same sealing scheme used by the web and node engines. A fresh 96-bit IV is
 * drawn for every call.
 *
 * @param subtle - The host Subtle implementation (`react-native-quick-crypto`'s
 *   `subtle` in production; Node's `globalThis.crypto.subtle` in tests).
 * @param key - The AES-256 master key bytes.
 * @param data - The plaintext string to seal.
 * @returns A JSON string containing the base64 IV and base64 ciphertext (the
 *   GCM authentication tag is appended to the ciphertext by Subtle).
 */
export async function sealData(
  subtle: SubtleCrypto,
  key: Buffer | Uint8Array,
  data: string,
): Promise<string> {
  const cryptoKey = await subtle.importKey("raw", bs(key), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(data);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, cryptoKey, bs(plaintext)),
  );

  return JSON.stringify({
    iv: base64.encode(iv),
    content: base64.encode(ciphertext),
  });
}

/**
 * Opens a payload produced by {@link sealData} using the host
 * {@link SubtleCrypto} AES-256-GCM.
 *
 * @param subtle - The host Subtle implementation (`react-native-quick-crypto`'s
 *   `subtle` in production; Node's `globalThis.crypto.subtle` in tests).
 * @param key - The AES-256 master key bytes.
 * @param payload - The JSON string produced by {@link sealData}.
 * @returns The decrypted plaintext string.
 */
export async function openData(
  subtle: SubtleCrypto,
  key: Buffer | Uint8Array,
  payload: string,
): Promise<string> {
  const { iv, tag, content } = JSON.parse(payload);
  const cryptoKey = await subtle.importKey("raw", bs(key), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  // Legacy payloads (quick-crypto `createCipheriv`) stored the GCM auth tag in a
  // separate `tag` field, whereas Subtle expects it appended to the ciphertext.
  // Concatenate for legacy `{iv,tag,content}` payloads; new `{iv,content}`
  // payloads already carry the tag inside `content`. This keeps records sealed
  // by the old scheme readable, so they migrate transparently on next write.
  const ciphertext =
    typeof tag === "string"
      ? (() => {
          const body = base64.decode(content);
          const authTag = base64.decode(tag);
          const combined = new Uint8Array(body.byteLength + authTag.byteLength);
          combined.set(body, 0);
          combined.set(authTag, body.byteLength);
          return combined;
        })()
      : base64.decode(content);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: bs(base64.decode(iv)) },
    cryptoKey,
    bs(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}
