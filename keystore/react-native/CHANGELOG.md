# [react-native-keystore@1.0.0-canary.16](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.15...react-native-keystore@1.0.0-canary.16) (2026-08-13)

### Features

- keystore migrations ([a7ed907](https://github.com/algorandfoundation/wallet-provider-extensions/commit/a7ed90757812833b0712b85438651d008a1e49dc))

# [react-native-keystore@1.0.0-canary.15](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.14...react-native-keystore@1.0.0-canary.15) (2026-08-13)

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

# [react-native-keystore@1.0.0-canary.14](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.13...react-native-keystore@1.0.0-canary.14) (2026-08-06)

### Features

- subtle shims and platform targets (node, web, react-native) ([3eb3936](https://github.com/algorandfoundation/wallet-provider-extensions/commit/3eb393680886b8c982d06a0898ef76be6d40d3f3))

# [react-native-keystore@1.0.0-canary.12](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.11...react-native-keystore@1.0.0-canary.12) (2026-05-13)

### Features

- web crypto fallback for keys and generic secret import ([f7481b1](https://github.com/algorandfoundation/wallet-provider-extensions/commit/f7481b1dc95014c1903a4351d5fffc8c9995e31a))

# [react-native-keystore@1.0.0-canary.11](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.10...react-native-keystore@1.0.0-canary.11) (2026-04-16)

### Bug Fixes

- update to latest tanstack store ([173b193](https://github.com/algorandfoundation/wallet-provider-extensions/commit/173b193fc0c2ee4331de7da4dfd26ce0334be50d))
- use optional chaining for log store ([17f5b85](https://github.com/algorandfoundation/wallet-provider-extensions/commit/17f5b8508f8364cf946eee5c1c7c4ebe9a1993e5))

### Features

- allow passing in of log store in options ([8bd40f6](https://github.com/algorandfoundation/wallet-provider-extensions/commit/8bd40f607f9b8ee0f9893e467a99ebd2f2c3a5f5))

# [react-native-keystore@1.0.0-canary.10](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.9...react-native-keystore@1.0.0-canary.10) (2026-04-15)

### Features

- biometric authentication prompt for master key with configurable options ([3029fc6](https://github.com/algorandfoundation/wallet-provider-extensions/commit/3029fc630d8ce7bd3304dc430ce9ac4be39fb055))

# [react-native-keystore@1.0.0-canary.9](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.8...react-native-keystore@1.0.0-canary.9) (2026-04-09)

### Bug Fixes

- create new Uint8Array for cloning private key ([813cc5d](https://github.com/algorandfoundation/wallet-provider-extensions/commit/813cc5d656257adb4d3b4cfbf1cbde01615cb9ce))
- normalize the user handle for domain-specific key ([1f37c04](https://github.com/algorandfoundation/wallet-provider-extensions/commit/1f37c04050d60c0bb6e1a6e5d55a8a9a6bd14400))

# [react-native-keystore@1.0.0-canary.8](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.7...react-native-keystore@1.0.0-canary.8) (2026-04-08)

### Bug Fixes

- add repository information to package ([258d932](https://github.com/algorandfoundation/wallet-provider-extensions/commit/258d932295af627c7af2c748e8dec2f9270c5b63))

# [react-native-keystore@1.0.0-canary.7](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.6...react-native-keystore@1.0.0-canary.7) (2026-04-08)

### Bug Fixes

- id parameters being ignored ([4a0af8a](https://github.com/algorandfoundation/wallet-provider-extensions/commit/4a0af8a292088c903776b52777288baa662ab584))

# [react-native-keystore@1.0.0-canary.6](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.5...react-native-keystore@1.0.0-canary.6) (2026-03-06)

### Chores

- pin dependencies ([af3b20e](https://github.com/algorandfoundation/wallet-provider-extensions/commit/af3b20eb07001460f9e15967f65f02863929158c))

# [react-native-keystore@1.0.0-canary.5](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.4...react-native-keystore@1.0.0-canary.5) (2026-03-05)

### Bug Fixes

- pass publicKey to store ([617afad](https://github.com/algorandfoundation/wallet-provider-extensions/commit/617afadaa9657b9e66164223253b88b2611663f7))

# [react-native-keystore@1.0.0-canary.4](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.3...react-native-keystore@1.0.0-canary.4) (2026-03-05)

### Bug Fixes

- do not clear publicKey ([b91301c](https://github.com/algorandfoundation/wallet-provider-extensions/commit/b91301c37d00f68480352a97576f306864190623))

# [react-native-keystore@1.0.0-canary.3](https://github.com/algorandfoundation/wallet-provider-extensions/compare/react-native-keystore@1.0.0-canary.1...react-native-keystore@1.0.0-canary.3) (2026-03-04)

### Tests

- add full test suite, ensures example is working ([ed7f1ff](https://github.com/algorandfoundation/wallet-provider-extensions/commit/ed7f1ffd601614058d9298e82103f6f30b910123))

# react-native-keystore@1.0.0-canary.1 (2026-02-23)

### Chores

- lock packages to published release ([1566bb0](https://github.com/algorandfoundation/wallet-provider-extensions/commit/1566bb0b925f3851b4317f2ca24d6739f0ae79572))
