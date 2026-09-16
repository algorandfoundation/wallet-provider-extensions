#!/usr/bin/env node

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";

import { cosmiconfig } from "cosmiconfig";
import meow from "meow";
import { readPackage } from "read-pkg";
import type { Options } from "semantic-release";
import semanticRelease from "semantic-release";
import semanticGetConfig from "semantic-release/lib/get-config.js";

import { createInlinePlugin } from "./release.js";
import { RescopedStream } from "./stream.js";

import pkg from "../../package.json" with { type: "json" };

const { Signale } = createRequire(import.meta.url)("signale");

const cli = meow(
  `
    Usage
        $ package-releaser

    Options
        --ci        Set to false to skip Continuous Integration environment verifications
        --debug     Output debugging information. 
        --dry-run   Dry run mode.

    Examples
        $ package-releaser --debug
`,
  {
    flags: {
      ci: {
        type: "boolean",
      },
      debug: {
        type: "boolean",
      },
      dryRun: {
        type: "boolean",
      },
    },
    importMeta: import.meta,
  },
);

try {
  const monoPackage = await readPackage().catch(() => null);
  const rawSemanticConfig = await cosmiconfig("release").search(
    new URL("../../", import.meta.url).pathname,
  );

  const packageName = monoPackage?.name?.split("/").pop();
  console.log(`[${pkg.name}]: Processing package ${monoPackage?.name}`);
  console.log(`[${pkg.name}]: Current working directory: ${process.cwd()}`);
  console.log(`[${pkg.name}]: NPM_CONFIG_PROVENANCE before: ${process.env.NPM_CONFIG_PROVENANCE}`);
  if (monoPackage?.publishConfig?.provenance === true && !process.env.NPM_CONFIG_PROVENANCE) {
    console.log(`[${pkg.name}]: Setting NPM_CONFIG_PROVENANCE=true for ${monoPackage.name}`);
    process.env.NPM_CONFIG_PROVENANCE = "true";
  }
  console.log(`[${pkg.name}]: NPM_CONFIG_PROVENANCE after: ${process.env.NPM_CONFIG_PROVENANCE}`);

  // Per-package semantic-release config override from the package's own package.json.
  // Fall back to the raw manifest in case read-pkg normalization strips the custom field.
  let packageSemanticConfig: Partial<Options> = (monoPackage as any)?.release ?? {};
  if (Object.keys(packageSemanticConfig).length === 0) {
    try {
      const rawPkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      packageSemanticConfig = rawPkg.release ?? {};
    } catch {
      packageSemanticConfig = {};
    }
  }

  const options: Options = {
    tagFormat: packageName ? `${packageName}@\${version}` : undefined,
    ...rawSemanticConfig?.config,
    ...packageSemanticConfig,
    ...cli.flags,
  };
  console.log(
    `[${pkg.name}]: Branches config source: ${
      packageSemanticConfig.branches
        ? "package-level release override"
        : rawSemanticConfig?.config?.branches
          ? "root release config"
          : "semantic-release defaults"
    }`,
  );

  if (packageSemanticConfig.branches) {
    const branchName = (branch: unknown): string =>
      typeof branch === "string" ? branch : ((branch as { name: string })?.name ?? "");
    const currentBranch =
      process.env.GITHUB_REF_NAME ?? execSync("git branch --show-current").toString().trim();
    const packageBranches = [packageSemanticConfig.branches].flat();

    if (!packageBranches.some((branch) => branchName(branch) === currentBranch)) {
      console.log(
        `[${pkg.name}]: Branch "${currentBranch}" is not configured for releases of ${monoPackage?.name}; skipping.`,
      );
      process.exit(0);
    }

    // semantic-release requires at least one non-prerelease release branch in `branches`.
    // If the package override only lists prerelease branches (e.g. canary-only packages),
    // keep it as the release gate above but run semantic-release with the root branches.
    const hasReleaseBranch = packageBranches.some(
      (branch) => typeof branch === "string" || !(branch as { prerelease?: unknown })?.prerelease,
    );
    if (!hasReleaseBranch && rawSemanticConfig?.config?.branches) {
      console.log(
        `[${pkg.name}]: Package branches override has no release branch; using root branches for the semantic-release run.`,
      );
      options.branches = rawSemanticConfig.config.branches;
    }
  }

  console.log(`[${pkg.name}]: Dry run: ${options.dryRun}`);
  console.log(`[${pkg.name}]: Using options ${JSON.stringify(options, null, 2)}`);

  if (options.plugins) {
    options.plugins = options.plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === "@semantic-release/git") {
        return [
          plugin[0],
          {
            ...plugin[1],
            message: `chore(release): ${packageName} [skip ci]\n\n\${nextRelease.notes}`,
          },
        ];
      }

      return plugin;
    });
  }

  const monoContext = {
    cwd: process.cwd(),
    env: process.env,
    stderr: process.stderr,
    stdout: process.stdout,
  };

  const semanticConfig = await semanticGetConfig(
    {
      ...monoContext,
      logger: new Signale({ stream: new RescopedStream(monoContext.stderr, pkg.name) }),
    },
    options,
  );

  const inlinePlugin = createInlinePlugin(semanticConfig);

  const result = await semanticRelease(
    { ...options, ...inlinePlugin },
    {
      cwd: monoContext.cwd,
      env: monoContext.env,
      stderr: new RescopedStream(monoContext.stderr, pkg.name) as any,
      stdout: new RescopedStream(monoContext.stdout, pkg.name) as any,
    },
  );

  if (result && !options.dryRun && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "released=true\n");
  }

  process.exit(0);
} catch (error) {
  console.error(`[${pkg.name}]:`, error);
  process.exit(1);
}
