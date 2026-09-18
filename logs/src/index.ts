/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/logs` is a lightweight, generic log store for wallet
 * activity. The state is a plain `@tanstack/store` `Store<LogStoreState>` that
 * the application owns and can subscribe to directly; the pure store functions
 * (`addLog`, `removeLog`, `getLog`, `clearLogs`) drive it standalone, and the
 * {@link WithLogs} extension mounts the `log` namespace (`info`, `warn`,
 * `error`, `debug`, `trace`, `clear`) plus the reactive `logs` getter on a
 * Wallet Provider with zero configuration.
 *
 * Other extensions treat the log as an **optional** dependency and probe
 * `provider.log?.info(...)`.
 */

export * from "./extension.ts";
export * from "./store.ts";
export * from "./types.ts";
