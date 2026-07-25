module.exports = function (api) {
  api.cache(true);
  return {
    // `unstable_transformImportMeta` rewrites `import.meta` so it works under
    // Hermes. Several universal crypto dependencies pulled in by the keystore
    // (e.g. the WASM `falcon-1024` module and `@algorandfoundation/keystore-node`'s
    // keyring) use `import.meta.url`, which Hermes does not support natively.
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
