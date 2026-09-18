/**
 * @module default
 * @packageDocumentation
 *
 * React Native condition entry for `@algorandfoundation/connections`.
 * Resolved via the `react-native` export condition, it re-exports the
 * platform-neutral core primitives and the bundled default protocols, plus
 * the responder-role `WithConnections` engine of
 * `@algorandfoundation/react-native-connections`. The `options.connections`
 * block is the core `ConnectionsNamespace` as-is (inject a durable `driver`
 * such as an MMKV wrapper to persist sessions).
 *
 * @remarks
 * There is no react-native *transport* library behind this entry; each
 * provider specifies its own platform strategy per protocol. Under Metro the
 * `@algorandfoundation/connections-liquid-auth` re-export below itself
 * resolves through the `react-native` condition, so the native signaling seam
 * (`nativeSignalClientFactory`, backed by the vendored
 * `react-native-liquid-auth` background `SignalService`) arrives with the
 * default protocol.
 */

export * from "@algorandfoundation/connections-core";
export * from "@algorandfoundation/connections-liquid-auth";
export * from "@algorandfoundation/react-native-connections";
