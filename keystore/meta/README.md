# @algorandfoundation/keystore

Meta package for the Wallet Provider Keystore. It contains **no implementation**
of its own; its `package.json` `exports` map uses runtime/bundler conditions to
resolve to the correct platform package:

| Condition        | Resolves to                           |
| ---------------- | ------------------------------------- |
| `node` / default | `@algorandfoundation/keystore-node`   |
| `browser`        | `@algorandfoundation/keystore-web`    |
| `react-native`   | `@algorandfoundation/keystore-node`\* |

\* The crypto implementation is universal (it uses the global `crypto` provided
by `react-native-quick-crypto`). The React Native **extension** (`WithKeyStore`,
biometric-backed storage) has a deliberately different API surface and is
published separately as
[`@algorandfoundation/react-native-keystore`](../react-native/README.md) — import
it directly in a React Native app alongside this package.

All platform packages re-export
[`@algorandfoundation/keystore-core`](../core/README.md), so the shared types,
errors, encoding and reactive-store helpers are always available regardless of
the resolved condition.

## Usage

```typescript
import { generateKey, signWithKeyData, setStatus } from "@algorandfoundation/keystore";
```

The import resolves to the implementation appropriate for the current platform.

## License

Apache-2.0
