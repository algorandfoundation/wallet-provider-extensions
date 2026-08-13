import type { Migration } from "@algorandfoundation/provider-migrations";
import type { KeystoreMigrationContext } from "../types.ts";
import { migration as r0001 } from "./0001-flag-legacy-passkeys.ts";
import { migration as r0002 } from "./0002-adopt-flat-records.ts";

/**
 * Every revision this package declares, ascending by id.
 *
 * Registered with the provider by {@link import("../extension.ts").WithKeyStore}
 * when a migrations extension is present.
 */
export const migrations: readonly Migration<KeystoreMigrationContext>[] = [r0001, r0002];
