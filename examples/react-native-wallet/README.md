# Wallet Provider (Test Harness)

This is a comprehensive React Native wallet example that serves as the **test harness for [Provider Extensions](../../)**.

It demonstrates how to compose multiple extensions into a single, unified `Provider` instance and how to handle reactive state and type narrowing in a real-world application.

## 🧱 Composed Extensions

The `ReactNativeProvider` in this application integrates several foundational extensions from this repository, along with local ones:

- **`WithLogStore`**: Unified logging for all operations.
- **`WithKeyStore`**: Secure storage and management of cryptographic keys (using `react-native-quick-crypto`).
- **`WithAccountStore`**: Centralized state management for Algorand accounts.
- **`WithAccountsKeystore`**: A bridge that links accounts to keys in the keystore, enabling signing capabilities.
- **`WithAlgorandAccounts`**: Automatically creates and syncs Algorand accounts from keystore keys (including balances/assets).
- **[`WithWatchedAccount`](./extensions/README.md)**: A local extension example for tracking accounts by public address (read-only).

## 🔀 Handling Multiple Account Types

A core pattern in this repository is using a single store to manage various types of accounts (e.g., keystore-backed, watched, multisig, etc.). We use **union types** and **type guards** to differentiate between them while maintaining a clean, unified API.

### `switch(true)` Pattern

In `app/accounts/index.tsx`, we use a `switch(true)` statement with type guards for type-safe rendering of different account types. This is the recommended way to handle multiple types in the same store:

```tsx
import { isKeystoreAccount } from "@algorandfoundation/accounts-keystore-extension";
import { isAlgorandAccount } from "@algorandfoundation/accounts-algorand-extension";
import { isWatchedAccount } from "@/extensions/example";

// ... inside the accounts map function
switch (true) {
  case isKeystoreAccount(item):
    // item is narrowed to KeystoreAccount (has .sign method, etc.)
    content = (
      <View>
        <MaterialCommunityIcons name="shield-key" size={24} />
        <Text>Keystore Account</Text>
      </View>
    );
    break;

  case isAlgorandAccount(item):
    // item is narrowed to AlgorandAccount (has .sign(txns) method)
    content = (
      <View>
        <MaterialCommunityIcons name="alpha-a-circle-outline" size={24} />
        <Text>Algorand Account</Text>
      </View>
    );
    break;

  case isWatchedAccount(item):
    // item is narrowed to WatchedAccount (has .name, etc.)
    content = (
      <View>
        <MaterialCommunityIcons name="eye-outline" size={24} />
        <Text>Watched Account ({item.name})</Text>
      </View>
    );
    break;

  default:
    // Fallback for generic accounts
    content = <Text>{item.address}</Text>;
}
```

## 🚀 Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Start the app**
   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## 💡 Key Files

- `providers/ReactNativeProvider.tsx`: The core provider definition composing all extensions.
- `app/_layout.tsx`: Provider initialization and app bootstrapping.
- `app/accounts/index.tsx`: Account list UI showing type-guard rendering for keystore, Algorand, and watched accounts.
- `extensions/example.ts`: Implementation of the local `WithWatchedAccount` extension.
- `app/accounts/index.tsx`: UI for managing accounts, demonstrating the `switch(true)` pattern.
