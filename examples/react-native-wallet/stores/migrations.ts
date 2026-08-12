import { keyValueLedger } from "@algorandfoundation/provider-migrations";
import type { MigrationLedger } from "@algorandfoundation/provider-migrations";
import { localStorage } from "@/stores/mmkv-local";

/**
 * The durable migration ledger, backed by the app's general-purpose MMKV
 * instance — deliberately separate from the `keystore` MMKV so the ledger
 * survives operations that clear key material.
 *
 * The separation cuts both ways: if the `keystore` MMKV is cleared, or
 * restored from a backup older than this app's data, the ledger still says
 * every revision up to the last-recorded one has been applied. Restored
 * legacy records are then never re-flagged, because from the ledger's point
 * of view nothing changed.
 */
export const migrationsLedger: MigrationLedger = keyValueLedger({
  get: (key) => localStorage.getString(key),
  set: (key, value) => {
    localStorage.set(key, value);
  },
});
