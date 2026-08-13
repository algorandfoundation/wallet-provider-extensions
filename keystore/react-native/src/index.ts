// Like the other platform packages (`keystore-node`, `keystore-web`), re-export
// the platform-neutral core (types, errors, shims, `createKeyStore`, constants)
// so a React Native app has a single import surface and never needs the
// `@algorandfoundation/keystore` meta package — whose dependency tree drags the
// wasm-backed web build into React Native installs.
export * from "@algorandfoundation/keystore-core";
export * from "./engine.ts";
export * from "./errors.ts";
export * from "./falcon.ts";
// Both core and `./falcon.ts` export a `createFalconBinding`; ambiguous star
// exports are silently dropped, so pick the native-module one explicitly.
export { createFalconBinding } from "./falcon.ts";
export * from "./extension.ts";
export * from "./prompts.ts";
export * from "./storage/index.ts";
export * from "./types.ts";
