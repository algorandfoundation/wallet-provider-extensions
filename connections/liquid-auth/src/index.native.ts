/**
 * @module default
 * @packageDocumentation
 *
 * React Native condition entry for
 * `@algorandfoundation/connections-liquid-auth`. Resolved via the
 * `react-native` export condition, it re-exports the full platform-neutral
 * protocol surface ({@link liquidAuth} and friends) plus the native signaling
 * seam: the {@link NativeSignalModuleLike} adapter over
 * `react-native-liquid-auth`'s background `SignalService` (vendored in
 * `../vendor/react-native-liquid-auth` until the module is published) and the
 * prewired {@link nativeSignalClientFactory} for the responder's
 * `createSignalClient` option. Nothing here reads `options.connections`;
 * the protocol is registered through `options.connections.protocols`.
 */

export * from "./index.ts";
export * from "./nativeSignal.ts";
export * from "./nativeModule.ts";
