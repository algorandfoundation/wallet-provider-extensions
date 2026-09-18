const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// `react-native-passkey-autofill` is linked from a sibling clone (see
// package.json's `link:` dependency); Metro only resolves modules inside
// its watched folders, so the clone must be watched explicitly.
// (`react-native-liquid-auth` is the workspace's vendored copy under
// `connections/liquid-auth/vendor`, and the Digital Credentials native
// module ships inside `@algorandfoundation/react-native-credentials` —
// both already live in this workspace's watched folders.)
const passkeyAutofillRoot = path.resolve(__dirname, "../../../react-native-passkey-autofill");
config.watchFolders = [...(config.watchFolders ?? []), passkeyAutofillRoot];

// The clone keeps its own devDependency installs (newer expo toolchains)
// in `node_modules`; if Metro resolved through it, the bundle would mix a
// second copy of react/expo-modules-core built for a different SDK than
// this app's native side. Block it so imports from the clone fall back to
// this workspace's node_modules (expo 54, single react instance).
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(`${escapeRegExp(passkeyAutofillRoot)}/node_modules/.*`),
];

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
