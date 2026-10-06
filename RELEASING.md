# Releasing: the 1.0.0 Release Train

This runbook describes how the coordinated **1.0.0 release train** ("Rocca 1.0.0") is promoted
from the current working tree to stable npm releases. It complements the per-package
[`@algorandfoundation/package-releaser`](./build) tooling and the
[`release.yml`](./.github/workflows/release.yml) workflow.

## How releases work here

- Every publishable package runs [semantic-release](https://semantic-release.gitbook.io/) via
  `package-releaser`, with commits **filtered to the package directory** and tags namespaced as
  `<unscoped-name>@<version>` (e.g. `keystore@1.0.0-canary.23`, `logs@1.0.0`).
- The shared `release` config lives in the root [`package.json`](./package.json):
  - `main` → prerelease channel `canary` (npm dist-tag `next`) → versions like `1.0.0-canary.x`.
  - `release` → stable channel (npm dist-tag `latest`).
- Packages that have never been released (no tags in their namespace) get semantic-release's
  **initial version 1.0.0**: `1.0.0-canary.1` on `main`, `1.0.0` on `release`. The `0.0.0` in
  their `package.json` is never used as a base.
- `pnpm run release:dry-run` at the root exercises every package's releaser without publishing.
  Note that version computation is branch-gated: on a feature branch it only validates
  configuration; the computed `1.0.0-canary.x` numbers appear when run on `main`.

## What ships stable in 1.0.0

Only the **keystore** family and **migrations** are eligible for the stable `1.0.0` release.
Every other publishable package is held on the canary line by a package-level `release`
override (see [Canary-Only Packages](./build/README.md#canary-only-packages)):

```json
"release": {
  "branches": [{ "name": "main", "prerelease": "canary", "channel": "next" }]
}
```

On `main` these packages keep cutting `1.0.0-canary.x` on `next`. On `release` the releaser
logs a skip and exits `0`, so the recursive release continues with the next package.

### Stable set (no `release` override)

| Directory               | Package                                     |
| ----------------------- | ------------------------------------------- |
| `keystore/core`         | `@algorandfoundation/keystore-core`         |
| `keystore/node`         | `@algorandfoundation/keystore-node`         |
| `keystore/web`          | `@algorandfoundation/keystore-web`          |
| `keystore/react-native` | `@algorandfoundation/react-native-keystore` |
| `keystore/meta`         | `@algorandfoundation/keystore`              |
| `migrations`            | `@algorandfoundation/provider-migrations`   |

The keystore packages only peer-depend on `@algorandfoundation/logs` as an **optional** peer, so
holding `logs` back does not block a stable keystore.

### Held back (canary-only)

- `logs`: `@algorandfoundation/logs`
- `accounts/*`: `accounts-core`, `accounts` (meta), `accounts-keystore-extension`,
  `accounts-connections-extension`, `algorand-accounts-extension`
- `identities/*`: `identities-core`, `identities` (meta), `identities-keystore-extension`,
  `identities-connections-extension`, `identities-intermezzo-extension`
- `credentials/*`: `credentials-core`, `credentials-node`, `credentials-web`,
  `react-native-credentials`, `credentials` (meta), `credentials-connections-extension`,
  `credentials-intermezzo-extension`
- `connections/*`: `connections-core`, `connections-web`, `connections-liquid-auth`,
  `react-native-connections`, `connections` (meta)
- `passkeys/*`: `passkeys-core`, `passkeys` (meta), `passkeys-keystore-extension`,
  `passkeys-connections-extension`, `react-native-passkeys`

New publishable packages outside `keystore/*` and `migrations` should add the same override
until they are ready for stable.

### Graduating a package

Delete the `release` field from the package's `package.json` and commit it together with a
`feat:`/`fix:` change under the package directory so a release qualifies. The package then
inherits the root `branches` and publishes a stable version on the next push to `release`.
Graduate dependencies before their dependents: a stable package must not require (as a
non-optional dependency or peer) a canary-only package, or its stable version would pin a
prerelease. Meta packages (e.g. `@algorandfoundation/accounts`) graduate together with, or
after, their core/extension packages.

### Precondition: stable `wallet-provider`

The stable keystore packages depend on `@algorandfoundation/wallet-provider` through the
workspace catalog, currently `^1.0.0-canary.7`. **Do not push `release` until
`@algorandfoundation/wallet-provider@1.0.0` is published to npm.** Then bump the catalog entry
in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) to `^1.0.0`, run
`pnpm install --no-frozen-lockfile`, and commit the lockfile, so no stable package ships with a
prerelease provider range.

### Checking the train

Simulate the stable branch locally (no publishing):

```bash
pnpm run build
GITHUB_REF_NAME=release pnpm run release:dry-run
```

Every held-back package logs a skip; only the stable set runs semantic-release. semantic-release
itself is branch-gated, so the stable set only computes `1.0.0` when the checked-out branch
really is `release` (and exists on the remote); elsewhere it only validates configuration.

## Promote runbook (canary → stable)

1. **Commit the restructure** on the working branch as a single release-triggering commit, e.g.
   `feat: 1.0.0 package structure (core/meta split, logs rename)`.
   - The commit type must be `feat:` (or stronger). A `chore:` commit would _not_ cut releases
     for the never-released packages, since each package's release is driven by qualifying
     commits under its own directory.
   - The restructure touches every publishable package directory, so this one commit qualifies
     all of them.
2. **Merge to `main`** (PR from the working branch). On push, `release.yml` builds the workspace
   and runs `pnpm run release`: every package cuts `1.0.0-canary.x` on the npm `next` dist-tag.
   - Existing canary lines continue (e.g. `keystore@1.0.0-canary.24`).
   - Fresh lines start at `1.0.0-canary.1` (`logs`, `accounts-core`, `identities-core`, all
     `connections-*`, `credentials-*` (`credentials-core`, `credentials-node`, `credentials-web`,
     `react-native-credentials`, `credentials-connections-extension`,
     `credentials-intermezzo-extension`), `passkeys-*`, and the `accounts`/`identities`/
     `credentials`/`connections` meta packages).
3. **Validate the canaries** by pointing the example apps (`examples/node-keystore`,
   `examples/web-keystore`, `examples/react-native-wallet`, `examples/use-wallet-client`) at the
   published `@next` versions (replace `workspace:*` with the canary versions in a scratch
   branch, or `pnpm add <pkg>@next` in a fresh app) and re-running their type-check/build/test.
4. **Promote to stable** (only after the [`wallet-provider@1.0.0` precondition](#precondition-stable-wallet-provider)
   is met): merge `main` into `release` and push. `release.yml` runs the releasers again on the
   stable channel; the stable set cuts `1.0.0` on `latest` and every held-back package is
   skipped. The workflow's final
   step rebases `main` onto `release` so the `chore(release)` commits flow back automatically.
5. **Follow up with Rocca**: once the stable packages are on npm, update the Rocca app's
   dependencies (separate effort, outside this repository).

## npm follow-ups for the maintainer

After the stable train lands:

- `npm deprecate @algorandfoundation/accounts-store "Renamed to @algorandfoundation/accounts-core"`
- `npm deprecate @algorandfoundation/identities-store "Renamed to @algorandfoundation/identities-core"`
- `npm deprecate @algorandfoundation/identities-extension "Superseded by the @algorandfoundation/identities meta package"`
- `npm deprecate @algorandfoundation/log-store "Renamed to @algorandfoundation/logs"`
- `npm deprecate @algorandfoundation/passkeys-store "Renamed to @algorandfoundation/passkeys-core"`
- `npm deprecate @algorandfoundation/passkeys-extension "Superseded by @algorandfoundation/passkeys-core"`

Stale tag namespaces in this repository (`accounts-store@*`, `identities-store@*`,
`identities-extension@*`, `log-store@*`) are left in place as history; the renamed packages
start fresh lines (`accounts-core@…`, `identities-core@…`, `logs@…`). The two deprecated
passkey names (`passkeys-store`, `passkeys-extension`) were published once as `0.0.1-beta.0`
placeholders outside the releaser, so they have no tag namespaces here. The
`passkeys-keystore-extension` name is **not** deprecated: the real bridge package now lives at
`passkeys/keystore-extension`, so the train's `1.0.0-canary.x` simply supersedes its
`0.0.1-beta.0` placeholder. `react-native-passkey-autofill` lives in its own repository and
keeps its name.
