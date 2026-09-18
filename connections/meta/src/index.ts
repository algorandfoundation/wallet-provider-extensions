/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/connections` is a thin **meta package** for the
 * connections domain. Its `package.json` `exports` map uses
 * runtime/bundler conditions to resolve to the correct platform engine,
 * mirroring `@algorandfoundation/keystore`,
 * `@algorandfoundation/identities` and `@algorandfoundation/credentials`:
 *
 * - `node` / default  → the platform-neutral
 *   `@algorandfoundation/connections-core` primitives plus the bundled
 *   default protocols (no engine; node hosts wire the engine of their
 *   choosing)
 * - `browser`         → adds the requester-role `WithConnections` engine
 *   of `@algorandfoundation/connections-web`
 * - `react-native`    → adds the responder-role `WithConnections` engine
 *   of `@algorandfoundation/react-native-connections`
 *
 * Every condition re-exports `@algorandfoundation/connections-core`
 * (sessions, the transport contract, the wallet RPC and the secure
 * channel) and ships the **default protocols**: today
 * `@algorandfoundation/connections-liquid-auth`'s {@link liquidAuth}
 * plug-in (`liquid://` QR requests, WebRTC signaling, seamless resume).
 *
 * @remarks
 * Unlike the other domains there is no per-platform *transport*
 * implementation baked into an engine: each provider specifies its own
 * platform strategy through the protocols it registers (e.g. the
 * `createSignalClient` seam of {@link liquidAuth}, which the
 * `react-native` condition of
 * `@algorandfoundation/connections-liquid-auth` prewires to the native
 * `SignalService`).
 */

export * from "@algorandfoundation/connections-core";
export * from "@algorandfoundation/connections-liquid-auth";
