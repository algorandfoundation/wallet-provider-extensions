# @algorandfoundation/package-releaser

`@algorandfoundation/package-releaser` is a custom release tool built on top of `semantic-release`. It is designed for use in a monorepo setup, allowing individual packages (extensions) to be released independently while sharing a global release configuration.

## Features

- **Monorepo Compatibility**: Correctly handles releases for individual packages within a monorepo.
- **Root Configuration Inheritance**: Automatically searches for and uses the `release` configuration defined in the root `package.json`.
- **Per-Package Configuration Overrides**: Each package can define its own `release` field in its `package.json` to override the root configuration (e.g., to opt out of stable releases).
- **Package-Specific Tagging**: Automatically formats git tags as `package-name@version` (e.g., `keystore@1.0.1`). Note: the `@algorandfoundation/` scope is automatically removed from the tag name.
- **Scoped Release Commits**: Customizes the `@semantic-release/git` commit message to include the name of the package being released (without the `@algorandfoundation/` scope), followed by its release notes.
- **Filtered Commits**: Only includes commits that affect the current package's directory or its workspace dependencies.

## Usage in Extensions

To use this tool in an extension (package) within this monorepo, follow these steps:

### 1. Add the Dependency

Add `@algorandfoundation/package-releaser` to the `dependencies` or `devDependencies` of your package.

```json
{
  "dependencies": {
    "@algorandfoundation/package-releaser": "0.0.1"
  }
}
```

### 2. Add the Release Script

Add a `release` script to your package's `package.json`. This script should call `package-releaser`.

```json
{
  "scripts": {
    "release": "package-releaser"
  }
}
```

### 3. Run the Release

You can now run the release from within the package directory:

```bash
npm run release
```

Or from the root of the monorepo using workspaces:

```bash
npm run release -w @algorandfoundation/keystore
```

## Global Configuration

The tool expects a `release` configuration in the root `package.json` of the monorepo. It supports standard `semantic-release` plugins and options.

### Example Root `package.json` Configuration

```json
{
  "release": {
    "plugins": [
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "@semantic-release/changelog",
      "@semantic-release/npm",
      [
        "@semantic-release/git",
        {
          "assets": ["CHANGELOG.md", "package.json"]
        }
      ],
      "@semantic-release/github"
    ],
    "branches": ["main", "release"]
  }
}
```

## Per-Package Configuration Overrides

A package can override the shared root configuration by declaring its own `release` field in its `package.json`. The merge precedence is:

1. `tagFormat` default (`<unscoped-name>@${version}`)
2. Root `release` configuration (from the root `package.json`)
3. Package-level `release` configuration (from the package's own `package.json`)
4. CLI flags (e.g., `--dry-run`)

Fields are merged shallowly: a field defined in the package's `release` replaces the root value wholesale (no deep merge). The tool logs whether the effective `branches` come from the root configuration or a package-level override.

### Canary-Only Packages

Packages that are not ready for a stable release can opt out declaratively by overriding `branches` with only the prerelease branch:

```json
{
  "release": {
    "branches": [{ "name": "main", "prerelease": "canary", "channel": "next" }]
  }
}
```

Behavior:

- On a push to `main`, the package releases `canary` prereleases exactly as before.
- On a push to `release` (or any branch not listed in the override), the tool logs a clear skip message and exits with code `0`, so the recursive root release (`pnpm run -r release`) continues with the next package. No `released=true` is written to `GITHUB_OUTPUT` for skipped packages.

Note: `semantic-release` requires at least one non-prerelease branch in `branches`, so a prerelease-only override cannot be passed to it directly. The tool therefore uses the package-level `branches` as a _release gate_ (current branch must be listed, otherwise skip) and falls back to the root `branches` for the actual `semantic-release` run when the override contains no release branch. Overrides that do contain a release branch are passed through unchanged.

## Stable Release Promotion Runbook

To promote the stable-ready packages to `1.0.0` (npm `latest`):

1. **Preconditions**:
   - `@algorandfoundation/wallet-provider@1.0.0` must be published to npm. Then bump the catalog entry in `pnpm-workspace.yaml` from `"^1.0.0-canary.5"` to `"^1.0.0"`, run `pnpm install`, and commit the lockfile update.
   - Check whether a stable `@algorandfoundation/xhd-wallet-api` matching `^2.0.0` exists; bump the catalog if so, otherwise it remains an accepted prerelease dependency.
   - Optionally verify version computation with a dry-run: `pnpm run release:dry-run`.
2. **Create and push the release branch** from `main`:

   ```bash
   git checkout main && git pull
   git checkout -b release
   git push origin release
   ```

3. **CI publishes stable versions**: the release workflow runs `pnpm run release` sequentially (`--workspace-concurrency 1`) in topological order. Packages without a `release` override publish `1.0.0` to the `latest` channel with tags like `keystore-core@1.0.0`; canary-only packages are skipped gracefully. The meta package (`@algorandfoundation/keystore`) publishes last among the keystore packages, so its `workspace:*` dependencies resolve to the freshly published stable versions.
4. **Sync `main`**: the workflow rebases `main` onto `release` after a successful stable release, so the release commits (version bumps, changelogs) land back on `main`.

### Graduating a Canary-Only Package

When a canary-only package becomes ready for stable releases, simply delete the `release` field from its `package.json`. It will then inherit the root configuration and publish a stable version on the next push to the `release` branch.

## CLI Options

The tool supports several `semantic-release` CLI flags:

- `--ci`: Set to `false` to skip Continuous Integration environment verifications.
- `--debug`: Output debugging information.
- `--dry-run`: Run in dry-run mode to see what would happen without actually releasing.

Example:

```bash
npm run release -- --dry-run
```

## Technical Implementation Details

The tool implements a `semantic-release` inline plugin that:

1. Filters commits based on the files they change, ensuring only relevant changes trigger a release for the specific package.
2. Intercepts the `@semantic-release/git` plugin configuration to inject a package-specific commit message: `chore(release): [skip ci] package-name \n\n${nextRelease.notes}`. (Where `package-name` is the package name without the `@algorandfoundation/` scope).
