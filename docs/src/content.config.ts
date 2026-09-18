import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    // Same pattern as Starlight's `docsLoader`, but also ignores the `_media`
    // folders that TypeDoc emits when package READMEs link to sibling files.
    loader: glob({
      base: "./src/content/docs",
      pattern: ["**/[^_]*.{markdown,mdown,mkdn,mkd,mdwn,md,mdx}", "!**/_media/**"],
    }),
    schema: docsSchema(),
  }),
};
