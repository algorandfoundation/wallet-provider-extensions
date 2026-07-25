/**
 * React Native condition entry for `@algorandfoundation/keystore`.
 *
 * Resolved via the `react-native` export condition. The cryptographic
 * implementation is universal (it uses the global `crypto` provided by
 * `react-native-quick-crypto`), so this simply delegates to
 * `@algorandfoundation/keystore-node`.
 *
 * The React Native specific `WithKeyStore` extension and biometric storage live
 * in `@algorandfoundation/react-native-keystore` and should be imported from
 * there directly.
 */

export * from "@algorandfoundation/react-native-keystore";
