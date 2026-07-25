const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "crypto" || moduleName === "node:crypto") {
    // when importing crypto, resolve to react-native-quick-crypto
    return context.resolveRequest(context, "react-native-quick-crypto", platform);
  }

  if (moduleName === "falcon-1024") {
    // The bundled WASM `falcon-1024` binding cannot run under Hermes (it relies
    // on top-level `await` and WebAssembly). React Native uses the native
    // `@joe-p/react-native-falcon` module instead, so the keystore only reaches for the
    // WASM package as a fallback. Map it to an empty module so it is excluded
    // from the bundle; the keystore then simply leaves Falcon-1024 out of its
    // default shim set (unless a native binding is provided).
    return { type: "empty" };
  }

  // otherwise chain to the standard Metro resolver.
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
