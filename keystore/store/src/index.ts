/**
 * @module default
 * @packageDocumentation
 *
 * While this entry point still works for backward compatibility, it is recommended to
 * migrate to named exports or use specific sub-paths:
 * - `@algorandfoundation/keystore/types`
 * - `@algorandfoundation/keystore/errors`
 *
 * Migration example:
 * ```typescript
 * // From
 * import { KeyStoreAPI } from "@algorandfoundation/keystore";
 *
 * // To
 * import { KeyStoreAPI } from "@algorandfoundation/keystore/types";
 * ```
 */

export * from "./crypto.ts";
export * from "./encoding.ts";
export * from "./errors.ts";
export * from "./extension.ts";
export * from "./generate.ts";
export * from "./sign.ts";
export * from "./store.ts";
export * from "./types/index.ts";
export * from "./verify.ts";
