/**
 * The node OS-keychain {@link KeyStoreDriver}: the server "material custodian"
 * for the shared {@link import("@algorandfoundation/keystore-core").createKeyStore}
 * orchestrator.
 *
 * Design (per the confirmed node-engine plan):
 *
 * - **Secret material lives directly in the OS keychain.** Each key's private
 *   bytes are base64-encoded and written to a keychain entry keyed by the key
 *   id; the driver relies on the OS keychain's own encryption-at-rest rather
 *   than adding an app-level cipher over the material. Because some backends
 *   (Windows Credential Manager) cap an entry at ~2.5 KB, oversized material —
 *   notably Falcon-1024 private keys — is **chunked** across numbered entries
 *   (`m/<id>`, `m/<id>/1`, `m/<id>/2`, …) and reassembled on read.
 * - **All metadata lives in one sealed file.** UI-safe {@link Key} records are
 *   kept together in a single blob that is AES-GCM sealed with a small master
 *   key held in the keychain, so there is no per-entry size limit for metadata.
 *
 * The keychain is byte-only, so {@link DriverCapabilities.nativeCryptoKey} is
 * `false` and every standard key is serialized to bytes by the orchestrator. The
 * keychain access here is non-interactive, so the per-operation context is
 * `void`.
 */

import type {
  DriverCapabilities,
  DriverMaterial,
  Key,
  KeyId,
  KeyStoreDriver,
} from "@algorandfoundation/keystore-core";
import { KeyNotFoundError } from "@algorandfoundation/keystore-core";
import { base64 } from "@scure/base";

import type { KeyringBinding } from "./keyring.ts";
import type { MetadataFile } from "./metadata.ts";

/** Keychain account prefix for a key's (possibly chunked) secret material. */
const MATERIAL_PREFIX = "m/";
/** Keychain account holding the AES-GCM master key that seals the metadata file. */
const MASTER_ACCOUNT = "__keystore.master__";
/**
 * Max characters per material chunk. Windows Credential Manager caps a
 * credential blob at 2560 bytes and encodes the secret as UTF-16 (2 bytes per
 * character), so 1024 chars (~2 KB) stays comfortably under the limit on every
 * platform.
 */
const CHUNK_SIZE = 1024;
/** AES-GCM IV length in bytes (96-bit, the recommended GCM nonce size). */
const IV_LENGTH = 12;

/** Dependencies for {@link createKeychainDriver}. */
export interface KeychainDriverDeps {
  /** The OS-keychain binding holding material + the metadata master key. */
  keyring: KeyringBinding;
  /** The sealed-metadata file store. */
  metadata: MetadataFile;
  /**
   * Host Subtle used to seal/unseal the metadata file (AES-GCM). Never a shim
   * decorator. Defaults to `globalThis.crypto.subtle`.
   */
  subtle?: SubtleCrypto;
}

const CAPABILITIES: DriverCapabilities = {
  nativeCryptoKey: false,
  interactiveUnlock: false,
  authFactors: ["hardware-backed"],
};

/** Casts a `Uint8Array` to the strict `BufferSource` overload WebCrypto expects. */
function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** Serializes {@link Key} records to bytes, base64-encoding any `Uint8Array`. */
function serializeRecords(records: Key[]): Uint8Array {
  const json = JSON.stringify(records, (_k, value) => {
    if (value instanceof Uint8Array) return { $u8: base64.encode(value) };
    return value;
  });
  return new TextEncoder().encode(json);
}

/** Reverses {@link serializeRecords}, restoring `Uint8Array` fields. */
function deserializeRecords(bytes: Uint8Array): Key[] {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json, (_k, value) => {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { $u8?: unknown }).$u8 === "string"
    ) {
      return base64.decode((value as { $u8: string }).$u8);
    }
    return value;
  }) as Key[];
}

/**
 * Creates a {@link KeyStoreDriver} backed by an injected OS keychain (material +
 * a metadata master key) and a single sealed metadata file.
 *
 * Secret material is stored in the keychain (chunked when it exceeds the safe
 * per-entry size) and relies on the keychain's encryption at rest; decrypted
 * bytes live only inside the {@link KeyStoreDriver.use} callback and are wiped
 * once it settles. All key metadata is kept in one AES-GCM sealed file, keyed by
 * a master key held in the keychain, so metadata has no per-entry size limit.
 *
 * @param deps - {@link KeychainDriverDeps}.
 * @returns A {@link KeyStoreDriver} to hand to `createKeyStore`. Its `ready`
 *   promise resolves once the sealed metadata file has been loaded.
 */
export function createKeychainDriver(deps: KeychainDriverDeps): KeyStoreDriver<void> {
  const { keyring, metadata } = deps;
  const host = deps.subtle ?? globalThis.crypto.subtle;

  const records = new Map<KeyId, Key>();
  let master: CryptoKey | undefined;

  /** Loads (or, when `create`, mints + persists) the metadata master key. */
  const loadMaster = async (create: boolean): Promise<CryptoKey | undefined> => {
    if (master) return master;
    let raw = keyring.get(MASTER_ACCOUNT);
    if (raw === null) {
      if (!create) return undefined;
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      raw = base64.encode(bytes);
      keyring.set(MASTER_ACCOUNT, raw);
      bytes.fill(0);
    }
    const keyBytes = base64.decode(raw);
    master = await host.importKey("raw", bs(keyBytes), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    keyBytes.fill(0);
    return master;
  };

  /** Seals the current in-memory metadata map to the file (`[iv | ciphertext]`). */
  const persist = async (): Promise<void> => {
    const key = (await loadMaster(true)) as CryptoKey;
    const plaintext = serializeRecords([...records.values()]);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = new Uint8Array(
      await host.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(plaintext)),
    );
    plaintext.fill(0);
    const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(ciphertext, IV_LENGTH);
    metadata.write(out);
  };

  const ready = (async (): Promise<void> => {
    const sealed = metadata.read();
    if (sealed === null || sealed.byteLength === 0) return;
    const key = await loadMaster(false);
    if (!key) {
      throw new Error(
        "keystore metadata is present but its master key is missing from the keychain",
      );
    }
    const iv = sealed.subarray(0, IV_LENGTH);
    const ciphertext = sealed.subarray(IV_LENGTH);
    const plaintext = new Uint8Array(
      await host.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ciphertext)),
    );
    const parsed = deserializeRecords(plaintext);
    plaintext.fill(0);
    for (const record of parsed) records.set(record.id, record);
  })();

  /** Keychain account for chunk `i` of key `id`'s material. */
  const account = (id: KeyId, i: number): string =>
    i === 0 ? MATERIAL_PREFIX + id : `${MATERIAL_PREFIX}${id}/${i}`;

  /** Removes every (chunk) entry for key `id`'s material. */
  const removeMaterial = (id: KeyId): void => {
    keyring.delete(account(id, 0));
    let i = 1;
    while (keyring.delete(account(id, i))) i += 1;
  };

  /** Writes key `id`'s material, chunked across numbered keychain entries. */
  const writeMaterial = (id: KeyId, bytes: Uint8Array): void => {
    removeMaterial(id);
    const b64 = base64.encode(bytes);
    let i = 0;
    for (let off = 0; off < b64.length; off += CHUNK_SIZE) {
      keyring.set(account(id, i), b64.slice(off, off + CHUNK_SIZE));
      i += 1;
    }
  };

  /** Reassembles key `id`'s material from its chunks, or `null` when absent. */
  const readMaterial = (id: KeyId): Uint8Array | null => {
    const first = keyring.get(account(id, 0));
    if (first === null) return null;
    let b64 = first;
    let i = 1;
    for (;;) {
      const chunk = keyring.get(account(id, i));
      if (chunk === null) break;
      b64 += chunk;
      i += 1;
    }
    return base64.decode(b64);
  };

  return {
    capabilities: CAPABILITIES,
    ready,

    async put(id: KeyId, material: DriverMaterial): Promise<void> {
      if (material.kind !== "bytes") {
        throw new Error("the keychain driver cannot persist a CryptoKey; expected bytes");
      }
      try {
        writeMaterial(id, material.bytes);
      } finally {
        material.bytes.fill(0);
      }
    },

    async use<T>(
      id: KeyId,
      _ctx: void,
      fn: (material: DriverMaterial) => T | Promise<T>,
    ): Promise<T> {
      const bytes = readMaterial(id);
      if (bytes === null) throw new KeyNotFoundError(id);
      try {
        return await fn({ kind: "bytes", bytes });
      } finally {
        // Defence-in-depth: the shims wipe injected material, but a decrypted
        // buffer must never outlive the operation regardless of the consumer.
        bytes.fill(0);
      }
    },

    async remove(id: KeyId): Promise<void> {
      removeMaterial(id);
      records.delete(id);
      await persist();
    },

    async clear(): Promise<void> {
      for (const id of records.keys()) removeMaterial(id);
      records.clear();
      await persist();
    },

    async putMeta(key: Key): Promise<void> {
      records.set(key.id, key);
      await persist();
    },

    async getMeta(id: KeyId): Promise<Key | undefined> {
      return records.get(id);
    },

    async listMeta(): Promise<Key[]> {
      return [...records.values()];
    },
  } satisfies KeyStoreDriver<void>;
}
