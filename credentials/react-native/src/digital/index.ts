/**
 * Barrel of the absorbed Digital Credentials expo native module.
 *
 * ⚠️ The default export loads the native module eagerly: importing this
 * barrel throws outside a React Native runtime with the module compiled in.
 * It is resolved lazily by `defaultDigitalCredentialsModule()` (see
 * `../provider.ts`); the package root only re-exports the runtime-safe
 * pieces (`./types.ts`, `./entries.ts`).
 */

// Reexport the native module: Android implements the Credential Manager
// registry, iOS resolves to an explicit "unsupported" stub.
export { default } from "./module.ts";
export * from "./types.ts";
export * from "./entries.ts";
