import type { Migration } from "@algorandfoundation/provider-migrations";
import type { KeychainStorage } from "../storage/driver.ts";
import { migration as r0001 } from "./0001-flag-legacy-passkeys.ts";

/**
 * Every revision this package declares, ascending by id.
 *
 * Registered with the provider by {@link import("../extension.ts").WithKeyStore}
 * when a migrations extension is present.
 */
export const migrations: readonly Migration<KeychainStorage>[] = [r0001];
