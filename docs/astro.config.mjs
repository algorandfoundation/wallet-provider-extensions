// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  integrations: [
    // Must come before starlight() so mermaid code blocks are claimed
    // before Expressive Code processes them.
    mermaid({ autoTheme: true }),
    starlight({
      title: "Wallet Provider Extensions",
      description:
        "Modular extensions for the Wallet Provider: keystore, accounts, identities, and more.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/algorandfoundation/wallet-provider-extensions",
        },
      ],
      plugins: [
        // Generates the API reference from the workspace packages.
        // Requires the packages to be built first (`pnpm build` at the workspace root).
        starlightTypeDoc({
          entryPoints: [
            "../keystore/core",
            "../keystore/react-native",
            "../accounts/core",
            "../accounts/keystore-extension",
            "../accounts/algorand-extension",
            "../accounts/connections-extension",
            "../identities/core",
            "../identities/keystore-extension",
            "../identities/connections-extension",
            "../connections/core",
            "../credentials/core",
            "../passkeys/core",
            "../passkeys/keystore-extension",
            "../passkeys/connections-extension",
            "../logs",
            "../migrations",
          ],
          output: "reference",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            entryPointStrategy: "packages",
            alwaysCreateEntryPointModule: true,
            // Emit a package index at /reference/ instead of a copy of the repo README.
            readme: "none",
            entryFileName: "index",
            skipErrorChecking: true,
            exclude: ["**/*.test.ts", "**/*.bench.ts"],
            // Applied to every package converted in `packages` mode.
            packageOptions: {
              skipErrorChecking: true,
              exclude: ["**/*.test.ts", "**/*.bench.ts"],
            },
            externalSymbolLinkMappings: {
              "@algorandfoundation/xhd-wallet-api": {
                KeyContext:
                  "https://algorandfoundation.github.io/xhd-wallet-api/enums/KeyContext.html",
              },
            },
          },
        }),
      ],
      sidebar: [
        {
          label: "Tutorials",
          items: [{ autogenerate: { directory: "tutorials" } }],
        },
        {
          label: "How-to Guides",
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Explanation",
          items: [{ autogenerate: { directory: "concepts" } }],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
