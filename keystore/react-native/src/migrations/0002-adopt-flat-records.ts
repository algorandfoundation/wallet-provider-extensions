import type { Migration, MigrationUtils } from "@algorandfoundation/provider-migrations";
import { migrateLegacyPasskeys } from "../storage/driver.ts";
import { adoptLegacyRecords } from "../storage/legacy.ts";
import type { KeystoreMigrationContext } from "../types.ts";

/**
 * Adopts legacy **flat** `<id>` records into the split `k/<id>` + `m/<id>`
 * layout the Keychain/MMKV driver reads.
 *
 * Before the driver split, a key was one flat MMKV entry keyed by its bare id,
 * whose sealed plaintext held metadata AND private material together. Two
 * writers produced that shape: this package's deprecated `commit()` helper and
 * the native passkey AutoFill credential provider, which writes into the same
 * MMKV instance from a separate process. Neither shape is visible to the
 * driver's `listMeta()` (it only scans `k/`), so without this revision those
 * records silently vanish from the reactive store after an upgrade.
 *
 * Unlike revision `0001` this **decrypts material**: each flat record is
 * opened with the master key (one read for the whole pass — the only step
 * that can raise a biometric/passcode prompt), its material re-sealed under
 * `m/<id>` and its metadata written in plaintext under `k/<id>`. Decrypted
 * buffers never leave {@link adoptLegacyRecords}, which zeroes them in its own
 * `finally` — the run-scoped secret scratch is therefore not needed here.
 *
 * A record that cannot be decoded, decrypted, or carries no `privateKey`/`seed`
 * material (e.g. a native credential wrapped by a biometric cipher this
 * package cannot open) is left untouched and reported through the provider's
 * log — never deleted, and never fatal for the revision.
 *
 * Finally the (idempotent, metadata-only) legacy-passkey flag pass runs again:
 * revision `0001` executed before any flat record was visible under `k/`, so
 * a legacy passkey that was still flat at that point would otherwise escape
 * flagging forever — the ledger records `0001` as applied and never re-runs it.
 */
export const migration: Migration<KeystoreMigrationContext> = {
  id: 2,
  name: "adopt-flat-records",
  up: async (context: KeystoreMigrationContext, utils: MigrationUtils): Promise<void> => {
    const { adopted, skipped } = await adoptLegacyRecords(context);

    for (const failure of skipped) {
      utils.log?.warn(
        `Could not adopt flat record "${failure.id}"; left untouched`,
        {
          module: utils.revision.module,
          error: failure.error instanceof Error ? failure.error.message : String(failure.error),
        },
        utils.revision.module,
      );
    }
    if (adopted.length > 0) {
      utils.log?.info(
        `Adopted ${adopted.length} flat record(s) into the split k/ + m/ layout`,
        { module: utils.revision.module },
        utils.revision.module,
      );
    }

    // Newly adopted records may include legacy passkeys revision 0001 could
    // not see (they were still flat when it ran). The pass is idempotent, so
    // re-running it here is safe and closes that gap.
    migrateLegacyPasskeys(context.storage);
  },
};

export default migration;
