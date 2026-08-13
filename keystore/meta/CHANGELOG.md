# [keystore@1.0.0-canary.23](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.22...keystore@1.0.0-canary.23) (2026-08-13)

### Features

- extractable keys and seeds ([b78f0f8](https://github.com/algorandfoundation/wallet-provider-extensions/commit/b78f0f8a0acc0d3c895ae9155f56ddb4ca6f0a55))

# [keystore@1.0.0-canary.22](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.21...keystore@1.0.0-canary.22) (2026-08-13)

### Bug Fixes

- bind to core package ([d4f1e35](https://github.com/algorandfoundation/wallet-provider-extensions/commit/d4f1e3563abb6d8eb4a5cd3aaf38982786a25419))
- **react-native-keystore:** export core from react native ([00b8b2e](https://github.com/algorandfoundation/wallet-provider-extensions/commit/00b8b2eb9dfe6dc7c7be63b51c52d56125129a23))

# [keystore@1.0.0-canary.21](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.20...keystore@1.0.0-canary.21) (2026-08-13)

### Bug Fixes

- **keystore-core:** backwards compatibility for deprecated hd-seed ([9559130](https://github.com/algorandfoundation/wallet-provider-extensions/commit/9559130bf9d0bab1ad2c7fe13e9ae636be61931c))

### Features

- **keystore-core:** native PBKDF2 for deterministic-P256 ([c92e5da](https://github.com/algorandfoundation/wallet-provider-extensions/commit/c92e5da9f3c6925745012dd488ef16360bd5d719))

# [keystore@1.0.0-canary.20](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.19...keystore@1.0.0-canary.20) (2026-08-13)

### Features

- keystore migrations ([a7ed907](https://github.com/algorandfoundation/wallet-provider-extensions/commit/a7ed90757812833b0712b85438651d008a1e49dc))

# [keystore@1.0.0-canary.19](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.18...keystore@1.0.0-canary.19) (2026-08-13)

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

# [keystore@1.0.0-canary.18](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.17...keystore@1.0.0-canary.18) (2026-08-06)

### Features

- subtle shims and platform targets (node, web, react-native) ([3eb3936](https://github.com/algorandfoundation/wallet-provider-extensions/commit/3eb393680886b8c982d06a0898ef76be6d40d3f3))

# [keystore@1.0.0-canary.16](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.15...keystore@1.0.0-canary.16) (2026-05-13)

### Features

- web crypto fallback for keys and generic secret import ([f7481b1](https://github.com/algorandfoundation/wallet-provider-extensions/commit/f7481b1dc95014c1903a4351d5fffc8c9995e31a))

# [keystore@1.0.0-canary.15](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.14...keystore@1.0.0-canary.15) (2026-04-16)

### Bug Fixes

- update to latest tanstack store ([173b193](https://github.com/algorandfoundation/wallet-provider-extensions/commit/173b193fc0c2ee4331de7da4dfd26ce0334be50d))
- use optional chaining for log store ([17f5b85](https://github.com/algorandfoundation/wallet-provider-extensions/commit/17f5b8508f8364cf946eee5c1c7c4ebe9a1993e5))

### Features

- allow passing in of log store in options ([8bd40f6](https://github.com/algorandfoundation/wallet-provider-extensions/commit/8bd40f607f9b8ee0f9893e467a99ebd2f2c3a5f5))

# [keystore@1.0.0-canary.14](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.13...keystore@1.0.0-canary.14) (2026-04-09)

### Bug Fixes

- create new Uint8Array for cloning private key ([813cc5d](https://github.com/algorandfoundation/wallet-provider-extensions/commit/813cc5d656257adb4d3b4cfbf1cbde01615cb9ce))
- normalize the user handle for domain-specific key ([1f37c04](https://github.com/algorandfoundation/wallet-provider-extensions/commit/1f37c04050d60c0bb6e1a6e5d55a8a9a6bd14400))

# [keystore@1.0.0-canary.13](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.12...keystore@1.0.0-canary.13) (2026-04-08)

### Bug Fixes

- id parameters being ignored ([4a0af8a](https://github.com/algorandfoundation/wallet-provider-extensions/commit/4a0af8a292088c903776b52777288baa662ab584))

# [keystore@1.0.0-canary.12](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.11...keystore@1.0.0-canary.12) (2026-03-06)

### Bug Fixes

- update signature for rawSign ([a2a2297](https://github.com/algorandfoundation/wallet-provider-extensions/commit/a2a229792039f993f458e0a3909795f70a7d57be))

# [keystore@1.0.0-canary.11](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.10...keystore@1.0.0-canary.11) (2026-03-06)

### Bug Fixes

- use rawSign for keystore signing ([756d787](https://github.com/algorandfoundation/wallet-provider-extensions/commit/756d7876a388f8d9f187058a2d1f4b8a4f9a0c7e))

# [keystore@1.0.0-canary.10](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.7...keystore@1.0.0-canary.10) (2026-03-04)

### Refactoring

- XHDPasskey to XHDDomainP256KeyData, include publicKey in Key ([c00274d](https://github.com/algorandfoundation/wallet-provider-extensions/commit/c00274d306b29758509e567f814674d812975949))

# [keystore@1.0.0-canary.7](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.6...keystore@1.0.0-canary.7) (2026-02-23)

### Chores

- lock packages to published release ([1566bb0](https://github.com/algorandfoundation/wallet-provider-extensions/commit/1566bb0b925f3851b4317f2ca24d6739f0ae79572))

# [keystore@1.0.0-canary.6](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.5...keystore@1.0.0-canary.6) (2026-02-23)

### Bug Fixes

- add watcher for logstore builds ([12d54d3](https://github.com/algorandfoundation/wallet-provider-extensions/commit/12d54d3cb26df8ae4acce71dec2fa14424598d45))

# [keystore@1.0.0-canary.5](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.4...keystore@1.0.0-canary.5) (2026-02-23)

### Bug Fixes

- rollback build optimization for log-store ([340ca78](https://github.com/algorandfoundation/wallet-provider-extensions/commit/340ca78317a742cd300abd26ac0c27f1197ba225))

# [keystore@1.0.0-canary.4](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.3...keystore@1.0.0-canary.4) (2026-02-23)

### Bug Fixes

- lock keystore dependencies ([c60daf7](https://github.com/algorandfoundation/wallet-provider-extensions/commit/c60daf7cc096313796e8ed109acc07b286e289ad))

# [keystore@1.0.0-canary.3](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.2...keystore@1.0.0-canary.3) (2026-02-23)

### Features

- pure interfaces with example app ([638b8b3](https://github.com/algorandfoundation/wallet-provider-extensions/commit/638b8b341d454635415b60f3dd5672642a08f7b2))
- react-native-keystore alignment ([44a2f0f](https://github.com/algorandfoundation/wallet-provider-extensions/commit/44a2f0fb6efb14e37afbafa3d7f6ab84da5b268c))

# [keystore@1.0.0-canary.2](https://github.com/algorandfoundation/wallet-provider-extensions/compare/keystore@1.0.0-canary.1...keystore@1.0.0-canary.2) (2026-02-18)

### Bug Fixes

- add releaser as dev dependency ([6f98967](https://github.com/algorandfoundation/wallet-provider-extensions/commit/6f989673af5b108ab1de9c439ec466e11fd2b863))

# keystore@1.0.0-canary.1 (2026-02-18)

### Features

- propose keystore generic and abstracted for any use case with multiple backend options ([673a491](https://github.com/algorandfoundation/wallet-provider-extensions/commit/673a491766ea46dc3377742eb54ec3f9f211906d))
- reflective api extension ([a6b2443](https://github.com/algorandfoundation/wallet-provider-extensions/commit/a6b24435b04b6a52bd6e9da90ea9a9025991ff1b))
- wallet keystore extension ([f96d471](https://github.com/algorandfoundation/wallet-provider-extensions/commit/f96d4717bd422f76a6d2c65d39b1269215723fee))
