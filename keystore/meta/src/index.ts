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
 * - `react-native`    → `@algorandfoundation/keystore-node` (the crypto is
 *   universal via `react-native-quick-crypto`'s global `crypto`)
 *
 * All platform packages re-export `@algorandfoundation/keystore-core`, so the
 * shared types, errors, encoding and reactive-store helpers are always
 * available regardless of the resolved condition.
 *
 * @remarks
 * The React Native *extension* (`WithKeyStore`, biometric-backed storage) has a
 * deliberately different API surface and is published separately as
 * `@algorandfoundation/react-native-keystore`; import it directly in a React
 * Native app alongside this package.
 */

export * from "@algorandfoundation/keystore-node";
