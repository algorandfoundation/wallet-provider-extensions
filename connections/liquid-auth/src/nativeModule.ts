/**
 * The package's consumption seam over the `react-native-liquid-auth`
 * expo module, currently the VENDORED snapshot in
 * `../vendor/react-native-liquid-auth` (an optional peer once the
 * module is published to npm; replace the vendor directory then).
 *
 * The module is resolved lazily by shape, mirroring how
 * `@algorandfoundation/react-native-credentials` resolves its native
 * Digital Credentials module: importing this file never throws in a
 * Node runtime (tests, tooling) where the native module cannot load;
 * resolution degrades to `undefined` and the prewired factory throws a
 * descriptive error only when actually used.
 */

import {
  createNativeSignalClientFactory,
  type NativeSignalClient,
  type NativeSignalClientFactoryOptions,
  type NativeSignalModuleLike,
} from "./nativeSignal.ts";

// Metro (React Native) transforms this module to CJS, so `require` exists
// at runtime; under Node ESM (tests, tooling) it does not and the lazy
// lookup below degrades to `undefined`.
declare const require: ((id: string) => unknown) | undefined;

/**
 * Lazily resolves the `react-native-liquid-auth` module namespace, when
 * the (vendored) package is installed and a CJS `require` exists in the
 * host runtime. Resolves `undefined` otherwise; callers then inject a
 * module explicitly via {@link createNativeSignalClientFactory}.
 *
 * @returns The native module surface, or `undefined` when not resolvable.
 */
export function defaultNativeSignalModule(): NativeSignalModuleLike | undefined {
  try {
    if (typeof require !== "function") return undefined;
    const resolved = require("react-native-liquid-auth") as NativeSignalModuleLike | undefined;
    // Validate by shape: bundler require shims can resolve to anything.
    if (
      resolved &&
      typeof resolved.start === "function" &&
      typeof resolved.connect === "function" &&
      typeof resolved.addMessageListener === "function"
    ) {
      return resolved;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the responder's `createSignalClient` seam prewired to the
 * vendored `react-native-liquid-auth` background `SignalService`:
 * `liquidAuth({ createSignalClient: nativeSignalClientFactory() })` is
 * all a React Native wallet needs for the QR-accept path.
 *
 * @param options - {@link NativeSignalClientFactoryOptions}.
 * @returns The `createSignalClient` seam backed by the native module.
 * @throws When the native module is unavailable in this runtime.
 */
export function nativeSignalClientFactory(
  options: NativeSignalClientFactoryOptions = {},
): (url: string) => NativeSignalClient {
  const module = defaultNativeSignalModule();
  if (!module) {
    throw new Error(
      "the react-native-liquid-auth native module is unavailable in this runtime; " +
        "inject one via createNativeSignalClientFactory(module) instead",
    );
  }
  return createNativeSignalClientFactory(module, options);
}
