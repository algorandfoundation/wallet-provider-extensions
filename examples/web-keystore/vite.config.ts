import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

/**
 * Vite config for the web keystore example.
 *
 * - `nodePolyfills` supplies the `crypto`/`Buffer` that the keystore's
 *   BIP32-Ed25519 (`@algorandfoundation/xhd-wallet-api`) and seed dependencies
 *   reach for; the keystore itself still runs its primitives via the host
 *   WebCrypto `SubtleCrypto`.
 * - The build/optimizer target is raised to `es2022` because the optional
 *   post-quantum `falcon-1024` binding is a WASM module that uses top-level
 *   `await` (supported by modern browsers, rejected at the default `es2020`).
 */
export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ["crypto", "buffer", "stream", "vm", "util"],
      globals: { Buffer: true },
    }),
  ],
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
