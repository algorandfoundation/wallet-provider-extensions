/**
 * @module default
 * @packageDocumentation
 *
 * `@algorandfoundation/keystore` is a thin **meta package**. It does not contain
 * any implementation of its own; instead its `package.json` `exports` map uses
 * runtime/bundler conditions to resolve to the correct platform package:
 *
 * - `node` / default  → `@algorandfoundation/keystore-node`
 * - `browser`         → `@algorandfoundation/keystore-web`
 * - `react-native`    → `@algorandfoundation/react-native-keystore`
 *
 * All platform packages re-export `@algorandfoundation/keystore-core`, so the
 * shared types, errors, encoding and reactive-store helpers are always
 * available regardless of the resolved condition.
 *
 * @remarks
 * React Native apps that want to avoid the meta package's dependency tree
 * (which includes the wasm-backed `@algorandfoundation/keystore-web`) can
 * depend on `@algorandfoundation/react-native-keystore` directly — it exposes
 * the same surface this package resolves to under the `react-native`
 * condition.
 */

export * from "@algorandfoundation/keystore-node";
