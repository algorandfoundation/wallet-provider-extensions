import * as Keychain from "react-native-keychain";
import { createCipheriv, createDecipheriv, randomBytes } from "react-native-quick-crypto";
import { MasterKeyNotFoundError, UnlockingError } from "../errors.ts";
import type { AuthenticationOptions } from "../types.ts";

const ALGORITHM = "aes-256-gcm";
const MASTER_KEY_CACHE_MS = 60_000;

let cachedMasterKey: Buffer | undefined;
let cachedMasterKeyExpiresAt = 0;

function clearCachedMasterKey() {
  cachedMasterKey?.fill(0);
  cachedMasterKey = undefined;
  cachedMasterKeyExpiresAt = 0;
}

function getCachedMasterKey(): Buffer | undefined {
  if (!cachedMasterKey || Date.now() > cachedMasterKeyExpiresAt) {
    clearCachedMasterKey();
    return undefined;
  }

  return Buffer.from(cachedMasterKey);
}

function cacheMasterKey(key: Buffer) {
  clearCachedMasterKey();
  cachedMasterKey = Buffer.from(key);
  cachedMasterKeyExpiresAt = Date.now() + MASTER_KEY_CACHE_MS;
}

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
  if (options?.biometrics) {
    const cached = getCachedMasterKey();
    if (cached) return cached;
  }

  const prompt = options?.prompt ?? "Authenticate to secure your wallet";
  const authenticationPrompt =
    typeof prompt === "string"
      ? { title: prompt }
      : (prompt ?? { title: "Authenticate to secure your wallet" });
  const credentials = await Keychain.getGenericPassword({
    service: "app-secret",
    authenticationPrompt,
  });
  if (credentials) {
    const key = Buffer.from(credentials.password, "hex");
    if (options?.biometrics) cacheMasterKey(key);
    return key;
  }

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
  const prompt = options?.prompt ?? "Authenticate to secure your wallet";
  const authenticationPrompt =
    typeof prompt === "string"
      ? { title: prompt }
      : (prompt ?? { title: "Authenticate to secure your wallet" });
  const biometricOptions = options?.biometrics
    ? {
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        authenticationPrompt,
      }
    : {};

  const newKey = Buffer.from(randomBytes(32)); // TODO: harden entropy
  const result = await Keychain.setGenericPassword("master", newKey.toString("hex"), {
    service: "app-secret",
    ...biometricOptions,
  });
  if (!result) {
    throw new UnlockingError("Failed to store master key");
  }

  if (options?.biometrics) cacheMasterKey(newKey);
  return Buffer.from(newKey);
}

/**
 * Encrypts data using AES-256-GCM with the provided key.
 * @param key - The encryption key
 * @param data - The string data to encrypt
 * @returns A JSON string containing IV, Auth Tag, and encrypted content
 */
export const encryptData = (key: Buffer, data: string): string => {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  // Return a combined payload
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    content: encrypted,
  });
};

/**
 * Decrypts data using AES-256-GCM with the provided key and payload.
 * @param key - The decryption key
 * @param payloadStr - The JSON string containing IV, Auth Tag, and content
 * @returns The decrypted string
 */
export const decryptData = (key: Buffer, payloadStr: string): string => {
  const { iv, tag, content } = JSON.parse(payloadStr);

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64") as any);

  let decrypted = decipher.update(content, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};
