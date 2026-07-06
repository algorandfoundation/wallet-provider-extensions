# Keystore Integration & Bootstrapping Guide

## Overview

The `@algorandfoundation/react-native-keystore` package provides a secure, persistent, and concrete keystore implementation for React Native applications. It integrates directly with the Algorand Wallet Provider and handles secure storage using MMKV (for encrypted key material) and Keychain (for the master encryption key).

## Core Principle: Separation of Concerns

The keystore follows a **clear separation** between UI state, encrypted storage, and encryption keys:

- **TanStack Store** → UI state (metadata, loading states, available keys).
- **MMKV** → Encrypted cryptographic keys and seeds (AES-256-GCM).
- **Keychain** → Master encryption key (Hardware-backed).

This ensures your raw private keys are never stored in React state or plain persistent storage.

## Prerequisites

Ensure you have the following peer dependencies installed in your React Native project:

- `react-native-keychain`: Secure storage for the master encryption key.
- `react-native-mmkv`: Fast, encrypted persistent storage for key material.
- `react-native-quick-crypto`: High-performance cryptographic operations.

### Quick Crypto Installation

In your app's entry point (e.g., `index.js` or `_layout.tsx`), you **must** install the quick crypto polyfills:

```typescript
import { install } from "react-native-quick-crypto";

install();
```

## Step-by-Step Integration

### 1. Configure the Store

Create a TanStack store for the keystore to manage its reactive state.

```typescript
// stores/keystore.ts
import { Store } from "@tanstack/store";
import { KeyStoreState } from "@algorandfoundation/keystore";

export const keyStore = new Store<KeyStoreState>({
  keys: [],
  status: "idle",
});
```

### 2. Initialize the Provider

In your main application file (e.g., `_layout.tsx` or `App.tsx`), initialize the `ReactNativeProvider` with the `WithKeyStore` extension.

```typescript
// providers/ReactNativeProvider.tsx
import React, { createContext, type ReactNode } from 'react';
import { Provider } from '@algorandfoundation/wallet-provider';
import { WithKeyStore } from "@algorandfoundation/react-native-keystore";
import { KeyStoreAPI, Key } from "@algorandfoundation/keystore";
import { keyStore } from "@/stores/keystore";

export class ReactNativeProvider extends Provider<typeof ReactNativeProvider.EXTENSIONS> {
    static EXTENSIONS = [
        WithKeyStore,
        // other extensions like WithLogStore or WithAccountStore
    ] as const

    keys!: Key[]
    status!: string
    keystore!: KeyStoreAPI
}

// Create the Context
export const AlgorandContext = createContext<null | ReactNativeProvider>(null);

// Create the Provider Component
export function AlgorandProvider({ children, provider }: { children: ReactNode, provider: ReactNativeProvider }) {
    return (
        <AlgorandContext.Provider value={provider}>
            {children}
        </AlgorandContext.Provider>
    )
}
```

### 3. Create the useProvider Hook

Use a custom hook to access the provider and its reactive state within your UI components.

```typescript
// hooks/useProvider.ts
import { useContext } from "react";
import { useStore } from "@tanstack/react-store";
import { AlgorandContext } from "@/providers/ReactNativeProvider";
import { keyStore } from "@/stores/keystore";

export function useProvider() {
  const provider = useContext(AlgorandContext);
  if (provider === null) throw new Error("No Provider Found");

  // Hydrate the store in the context (React)
  const keys = useStore(keyStore, (state) => state.keys);
  const status = useStore(keyStore, (state) => state.status);

  return { ...provider, keys, status };
}
```

### 4. Bootstrap the Keystore

During app startup, you must load the stored keys from persistent storage into the reactive store.

```typescript
// app/_layout.tsx
import { keyStore } from "@/stores/keystore";
import {
  createMasterKey,
  fetchSecret,
  readMasterKey,
  storage
} from "@algorandfoundation/react-native-keystore";
import {
  initializeKeyStore,
  Key,
  KeyData,
  KeyStoreState,
  setStatus
} from "@algorandfoundation/keystore";
import { AlgorandProvider, ReactNativeProvider } from "@/providers/ReactNativeProvider";

async function bootstrap() {
  setStatus({ store: keyStore as any, status: "loading" });

  // 1. Get all key IDs from MMKV storage
  const keyIds = storage.getAllKeys();

  // 2. Read the master encryption key from Keychain. Only create one when
  // there are no encrypted records that depend on an existing master key.
  const masterKey = keyIds.length === 0 ? await createMasterKey() : await readMasterKey();

  // 3. Fetch and decrypt each key from MMKV using the master key
  const secrets = await Promise.all(
    keyIds.map(async (keyId) =>
      fetchSecret<KeyData>({
        keyId,
        options: { masterKey }
      })
    )
  );

  // 4. Initialize the reactive store (excluding private keys for security)
  initializeKeyStore({
    store: keyStore as any,
    keys: secrets
      .filter((s) => s !== null)
      .map(({ privateKey, ...rest }) => rest) as Key[]
  });

  setStatus({ store: keyStore as any, status: "idle" });
}

bootstrap();

export default function RootLayout() {
  const provider = new ReactNativeProvider({
    id: 'my-app',
    name: 'My Application',
  }, {
    keystore: {
      store: keyStore
    }
  });

  return (
    <AlgorandProvider provider={provider}>
      {/* Your application components */}
    </AlgorandProvider>
  );
}
```

### 5. Advanced: Using with Account Store

If you are using the `WithAccountStore` and `WithAccountsKeystore` extensions, you can enable `autoPopulate` to automatically add derived keys to your account store.

```typescript
const provider = new ReactNativeProvider(
  {
    id: "my-app",
    name: "My Application",
  },
  {
    accounts: {
      store: accountsStore,
      keystore: {
        autoPopulate: true,
      },
    },
    keystore: {
      store: keyStore,
    },
  },
);
```

## Security Best Practices

1.  **Never store private keys in the TanStack store**: Always filter them out during initialization.
2.  **Separate reading from creation**: Use `readMasterKey()` for existing encrypted records, and only call `createMasterKey()` during explicit first-run initialization.
3.  **Automatic Cleanup**: The `sign`, `derive`, and `generate` methods automatically fetch private keys and clear them from memory after use.
4.  **MMKV vs Keychain**: Use MMKV for high-performance encrypted storage of key material, and Keychain for the root master key.
