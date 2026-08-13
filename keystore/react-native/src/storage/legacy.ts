/**
 * Adoption of the legacy **flat** `<id>` record layout (one sealed blob per
 * key, holding both metadata and material — see `commit`/`fetchSecret` in
 * `state.ts`) into the `k/<id>` + `m/<id>` pair {@link createKeychainDriver}
 * understands.
 *
 * Two independent writers still produce flat records: the deprecated
 * `commit()` helper (still called by consumers doing in-place metadata edits)
 * and the native Android/iOS passkey credential provider, which writes
 * straight into this MMKV instance from a separate process using the very
 * same shape. Neither is visible to {@link createKeychainDriver}'s
 * `listMeta()` (it only scans `k/`), so without this pass those records are
 * silently invisible to the reactive store.
 *
 * The pass is exposed to applications as tracked revision `0002`
 * (`adopt-flat-records`) of this package's migration manifest — see
 * `../migrations/0002-adopt-flat-records.ts` — rather than running ad hoc on
 * every engine start.
 */

import type { Key, KeyData } from "@algorandfoundation/keystore-core";
import { clearBuffer } from "@algorandfoundation/wallet-provider";
import { base64 } from "@scure/base";

import { MasterKeyNotFoundError } from "../errors.ts";
import type { AuthenticationOptions } from "../types.ts";
import { openData, sealData } from "./crypto.ts";
import { MATERIAL_PREFIX, METADATA_PREFIX, serializeKey } from "./driver.ts";
import type { KeychainStorage } from "./driver.ts";
import { decode } from "./state.ts";

/** A flat record that could not be adopted this pass, and why. */
export interface LegacyAdoptionFailure {
  /** The flat record's MMKV key (its key id). */
  id: string;
  /** The error that stopped adoption for this record. */
  error: unknown;
}

/** Outcome of a single {@link adoptLegacyRecords} pass. */
export interface LegacyAdoptionResult {
  /** Ids successfully split into `k/<id>` + `m/<id>` (flat record removed). */
  adopted: string[];
  /** Records left untouched — corrupt, undecryptable, or carrying no material. */
  skipped: LegacyAdoptionFailure[];
}

/** Dependencies for {@link adoptLegacyRecords}. */
export interface LegacyAdoptionDeps {
  /** The MMKV-style store holding both the flat records and the `k/`/`m/` pairs. */
  storage: KeychainStorage;
  /** Host Subtle implementation used to open/re-seal material. */
  subtle: SubtleCrypto;
  /**
   * Resolves the existing master key for a **read**. Must not create one —
   * a missing master key with no flat records around is the ordinary fresh
   * install, not an error.
   */
  masterKeyForRead: (options?: AuthenticationOptions) => Promise<Uint8Array>;
  /** Authentication policy forwarded to {@link LegacyAdoptionDeps.masterKeyForRead}. */
  authentication?: AuthenticationOptions;
}

/**
 * The default storage key `@algorandfoundation/provider-migrations`' key/value
 * ledger serialises its revision map under. Excluded defensively: applications
 * are advised to keep the ledger in its own MMKV instance, but one pointed at
 * this keystore's instance must never have its ledger blob treated as a flat
 * record — it would be reported as skipped and could raise a needless unlock
 * prompt. Kept as a literal so the storage layer stays free of any runtime
 * dependency on the migrations package.
 */
const MIGRATIONS_LEDGER_KEY = "@algorandfoundation/provider-migrations";

/** True for MMKV keys this pass should even consider as flat records. */
function isFlatCandidate(key: string): boolean {
  return (
    !key.startsWith(MATERIAL_PREFIX) &&
    !key.startsWith(METADATA_PREFIX) &&
    key !== MIGRATIONS_LEDGER_KEY
  );
}

/**
 * Adopts every legacy flat `<id>` record it can decrypt into the `k/<id>` +
 * `m/<id>` pair, so it becomes visible to `listMeta()`.
 *
 * @remarks
 * Cheap and side-effect-free when there is nothing to adopt: the MMKV keys are
 * scanned first and the master key is touched — the only operation that can
 * raise a biometric/passcode prompt — only when at least one flat candidate
 * exists. A missing master key is then treated as "nothing to migrate" rather
 * than an error, since a fresh install has neither a master key nor any flat
 * records. The pass is idempotent (already-adopted records are `k/`/`m/`
 * prefixed and therefore excluded) and never destructive: a record is removed
 * only after both the `k/<id>` and `m/<id>` writes have succeeded, and a
 * record that fails to decode, decrypt, or carries no `privateKey`/`seed`
 * material is left untouched and reported in {@link LegacyAdoptionResult.skipped}
 * instead of aborting the pass.
 *
 * @param deps - {@link LegacyAdoptionDeps}.
 * @returns Which ids were adopted and which were skipped (see
 *   {@link LegacyAdoptionResult}).
 *
 * @example
 * ```typescript
 * const { adopted, skipped } = await adoptLegacyRecords({
 *   storage,
 *   subtle,
 *   masterKeyForRead: (auth) => readMasterKey(auth),
 * });
 * ```
 */
export async function adoptLegacyRecords(deps: LegacyAdoptionDeps): Promise<LegacyAdoptionResult> {
  const { storage, subtle, masterKeyForRead, authentication } = deps;
  const candidateIds = storage.getAllKeys().filter(isFlatCandidate);
  const adopted: string[] = [];
  const skipped: LegacyAdoptionFailure[] = [];
  if (candidateIds.length === 0) return { adopted, skipped };

  let masterKey: Uint8Array;
  try {
    masterKey = await masterKeyForRead(authentication);
  } catch (error) {
    // No master key and nothing has ever been sealed with one — the ordinary
    // fresh install. Anything else (unlock cancelled, hardware failure, …) is
    // a real problem the caller should see.
    if (error instanceof MasterKeyNotFoundError) return { adopted, skipped };
    throw error;
  }

  try {
    for (const id of candidateIds) {
      const sealed = storage.getString(id);
      if (sealed === undefined) continue;

      let keyData: KeyData;
      try {
        keyData = decode(await openData(subtle, masterKey, sealed));
      } catch (error) {
        skipped.push({ id, error });
        continue;
      }

      const material = (keyData.privateKey ?? (keyData as { seed?: Uint8Array }).seed) as
        | Uint8Array
        | undefined;
      if (!(material instanceof Uint8Array)) {
        skipped.push({
          id,
          error: new Error(`legacy record "${id}" carries no privateKey/seed material`),
        });
        continue;
      }

      try {
        const {
          privateKey: _privateKey,
          seed: _seed,
          ...meta
        } = keyData as unknown as Record<string, unknown>;
        const metaRecord = { ...meta, id: keyData.id ?? id } as Key;
        const sealedMaterial = await sealData(subtle, masterKey, base64.encode(material));
        // Material first: if metadata fails to write, no orphaned `k/<id>`
        // without its material can exist. The flat record is only removed
        // once both writes have landed.
        storage.set(MATERIAL_PREFIX + id, sealedMaterial);
        storage.set(METADATA_PREFIX + id, serializeKey(metaRecord));
        storage.remove(id);
        adopted.push(id);
      } catch (error) {
        // Roll back any partial write so a stray `k/`/`m/` entry never
        // outlives a failed pass; the flat record itself was never removed,
        // so no data is lost.
        storage.remove(MATERIAL_PREFIX + id);
        storage.remove(METADATA_PREFIX + id);
        skipped.push({ id, error });
      } finally {
        clearBuffer(material);
      }
    }
  } finally {
    clearBuffer(masterKey);
  }

  return { adopted, skipped };
}
