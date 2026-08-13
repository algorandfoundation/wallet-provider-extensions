/**
 * Locks the package's public surface: like the other platform packages this
 * one re-exports `@algorandfoundation/keystore-core`, so a React Native app
 * imports everything from here and never needs the `@algorandfoundation/keystore`
 * meta package (whose dependency tree drags the wasm-backed web build into a
 * React Native install).
 */
import * as core from "@algorandfoundation/keystore-core";
import { describe, expect, it } from "vitest";

import { createFalconBinding as createNativeFalconBinding } from "./falcon.ts";
import * as index from "./index.ts";

describe("index", () => {
  it("re-exports the platform-neutral core surface", () => {
    expect(index.createKeyStore).toBe(core.createKeyStore);
    expect(index.createDefaultShims).toBe(core.createDefaultShims);
    expect(index.MaterialAccessError).toBe(core.MaterialAccessError);
    expect(index.DP256_ALGORITHM).toBe(core.DP256_ALGORITHM);
    expect(index.withSubtleDP256).toBe(core.withSubtleDP256);
  });

  it("keeps the React Native surface", () => {
    expect(index.WithKeyStore).toBeTypeOf("function");
    expect(index.loadDefaultFalconBinding).toBeTypeOf("function");
    expect(index.storage).toBeDefined();
  });

  it("resolves the createFalconBinding ambiguity to the native-module adapter", () => {
    // Both core and `./falcon.ts` export a `createFalconBinding`; a plain star
    // re-export would silently drop the ambiguous name, so the index exports
    // the native-module one explicitly.
    expect(index.createFalconBinding).toBe(createNativeFalconBinding);
    expect(index.createFalconBinding).not.toBe(core.createFalconBinding);
  });
});
