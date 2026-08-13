# provider-migrations@1.0.0-canary.1 (2026-08-13)

### Bug Fixes

- skip release git commits on protected main ([46710fe](https://github.com/algorandfoundation/wallet-provider-extensions/commit/46710fe34848f7dfbee565b033566583b56e9daa))

### Features

- **migrations:** opt-in data migrations engine for provider extensions ([495f336](https://github.com/algorandfoundation/wallet-provider-extensions/commit/495f33636d62c9ada84d13fd8ea82e18cc3a888d))

### BREAKING CHANGES

- **migrations:** instead of hand-rolling a startup fix-up pass.

WithMigrations is placed first in the extensions array, so provider.migrations
exists for every later extension, and the run is scheduled as a microtask so
the registry is complete before the first revision executes. Opted-in packages
import only `type { Migration }` and carry no runtime dependency on the engine.

- Storage-agnostic: each module declares its own opaque context type, so
  IndexedDB, MMKV and a sealed file all work without a shared interface.
- Ledger written per revision, never batched, so a killed run resumes exactly
  where it stopped.
- Forward-only and always from revision zero; migrations tolerate empty data.
- Per-module failure isolation: a failing revision halts only its own module,
  other modules still run, then `ready` rejects with an aggregate error.
- A ledger ahead of the installed code is reported and warned about, not
  thrown, since bricking an app on a downgrade is worse.
- Run-scoped SecretScratch for key material in flight: bytes only, zeroed in a
  finally, use-after-wipe throws, non-serializable. Hook payloads carry
  { module, revision } only.

react-native-keystore is the first adopter, with migrateLegacyPasskeys tracked
as revision 0001, and the react-native example wallet is wired up.

- **migrations:** legacy passkey flagging no longer runs automatically on engine
  start. It is now revision 0001 of the package's migration manifest and requires
  WithMigrations from @algorandfoundation/provider-migrations to be installed on
  the provider. Applications that do not add it will never flag legacy passkeys.
