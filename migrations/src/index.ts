/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/provider-migrations` runs revision-tracked, forward-only
 * data migrations for Wallet Provider extensions. The pure
 * {@link applyMigrations} engine works standalone over any
 * {@link MigrationLedger}; the {@link WithMigrations} extension mounts it as
 * `provider.migrations`, where later extensions register their modules with
 * `provider.migrations?.register(...)` (a no-op when the extension is absent,
 * which is the opt-in mechanism). Place `WithMigrations` **first** in the
 * extensions array.
 *
 * Test helpers live under the `@algorandfoundation/provider-migrations/testing`
 * entry point.
 */

export * from "./apply.ts";
export * from "./errors.ts";
export * from "./extension.ts";
export * from "./ledger.ts";
export * from "./secrets.ts";
export * from "./types.ts";
