import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

/**
 * Vite config for the use-wallet client (verifier) example.
 *
 * - The Digital Credentials API requires a secure context; `vite dev` on
 *   `localhost` qualifies, so no TLS setup is needed for local testing.
 * - `nodePolyfills` supplies the Node `crypto`/`Buffer` that
 *   `@algorandfoundation/liquid-client`'s encoding chain
 *   (`@algorandfoundation/algokit-utils` → `xhd-wallet-api`) reaches for
 *   when bundled for the browser.
 * - The `Buffer` shim is aliased to its resolved path because the plugin
 *   also injects it into workspace packages outside this example's root
 *   (e.g. `@algorandfoundation/keystore-core`'s dist), from where the
 *   bare `vite-plugin-node-polyfills/shims/buffer` specifier does not
 *   resolve under pnpm's strict node_modules layout.
 * - `build.target: "es2022"` and `optimizeDeps.esbuildOptions.target:
 *   "es2022"` because the keystore's optional `falcon-1024` shim
 *   initializes its WASM with top-level await, which the es2020-era
 *   defaults of both the production build and the dev-server dependency
 *   optimizer reject.
 */
export default defineConfig({
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  resolve: {
    alias: {
      "vite-plugin-node-polyfills/shims/buffer": fileURLToPath(
        import.meta.resolve("vite-plugin-node-polyfills/shims/buffer"),
      ),
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ["crypto", "buffer", "stream", "vm", "util"],
      globals: { Buffer: true },
    }),
  ],
});
