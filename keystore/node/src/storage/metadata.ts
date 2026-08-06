/**
 * The sealed metadata file the node keystore driver persists all key metadata
 * into.
 *
 * Rather than storing one keychain entry per key's metadata (which would hit the
 * ~2.5 KB Windows Credential Manager cap once a handful of keys exist), the node
 * driver keeps **all** UI-safe {@link import("@algorandfoundation/keystore-core").Key}
 * records together in a single file that is sealed (AES-GCM, keyed by a small
 * master key held in the OS keychain) and unsealed as a whole. This removes the
 * per-entry size limit for metadata while keeping the sensitive bits — the
 * secret material and the sealing key — inside the keychain.
 *
 * The file store is a tiny, injectable byte read/write/remove surface so the
 * default filesystem implementation can be swapped (e.g. for a test in-memory
 * store or a different durable location).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A minimal byte blob store for the single sealed metadata file. The bytes are
 * already AES-GCM sealed by the driver, so this surface is deliberately dumb —
 * it neither encrypts nor interprets what it stores.
 */
export interface MetadataFile {
  /** Reads the sealed blob, or `null` when it does not exist yet. */
  read(): Uint8Array | null;
  /** Writes (replacing) the sealed blob. */
  write(bytes: Uint8Array): void;
  /** Removes the sealed blob, if present. */
  remove(): void;
}

/** Options for {@link createFileMetadataStore}. */
export interface FileMetadataStoreOptions {
  /**
   * Absolute path of the sealed metadata file. Defaults to
   * {@link defaultMetadataPath}.
   */
  path?: string;
}

/**
 * The default sealed-metadata file location: `~/.algorand-keystore/metadata.bin`.
 *
 * @returns The absolute default path.
 */
export function defaultMetadataPath(): string {
  return join(homedir(), ".algorand-keystore", "metadata.bin");
}

/**
 * Creates a filesystem-backed {@link MetadataFile}.
 *
 * The parent directory is created on first write; reads of a missing file return
 * `null` (a fresh, empty keystore).
 *
 * @param options - {@link FileMetadataStoreOptions}.
 * @returns A {@link MetadataFile} over the local filesystem.
 */
export function createFileMetadataStore(options?: FileMetadataStoreOptions): MetadataFile {
  const path = options?.path ?? defaultMetadataPath();
  return {
    read(): Uint8Array | null {
      try {
        return new Uint8Array(readFileSync(path));
      } catch {
        return null;
      }
    },
    write(bytes: Uint8Array): void {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    },
    remove(): void {
      try {
        rmSync(path, { force: true });
      } catch {
        // Best effort: a missing file is already the desired state.
      }
    },
  };
}
