# Secret Store Extension

The Secret Store extension is a core component for the Algorand Wallet Provider, designed to securely manage application secrets. It provides a standardized interface for secret lifecycle management, including storage, retrieval, and removal of various secret types.

## Features

- **Standardized Secret Interface**: Use a consistent `Secret` format across different standards.
- **Multiple Secret Types**: Supports `algo25`, `bip39`, `intermezzo`, and custom token types.
- **Modular Design**: Built to work seamlessly with the `@algorandfoundation/wallet-provider` as an extension.
- **State Management**: Powered by `@tanstack/store` for predictable state transitions.

## Installation

```bash
npm install @algorandfoundation/secret-store
```

## Usage

### 1. Register the Extension

The Secret Store extension is designed to be used with the `@algorandfoundation/wallet-provider`. The `secretsStore` is managed by the extension itself and does not need to be manually created.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { withSecretStoreExtension } from "@algorandfoundation/secret-store";

// 1. Create a provider with the extension
const MyProvider = Provider.withExtensions([withSecretStoreExtension]);
const provider = new MyProvider({
  id: "my-provider",
  name: "My Wallet"
}) as any;

// 2. Use the secret API
await provider.secret.add({
  id: "my-secret-1",
  name: "Main Account",
  type: "algo25",
  value: "..." 
});
```


### 2. Using Hooks 

#### A. Node.js/Vanilla JS

To use the secret store hooks in any environment, you can listen to the `secretsStore` state changes or the before-after-hooks.

```typescript
import { secretsStore, secretStoreHooks } from "@algorandfoundation/secret-store";
import type { Secret } from "@algorandfoundation/secret-store";

// Subscribe to State changes (useful in reactive contexts like meta-frameworks)
secretsStore.subscribe((state) => {console.log(state)})

// Listen to before/after hooks (more implicit hooks than state changes)
secretStoreHooks.before('add', (secret: Secret)=>{
    // Do something before adding a secret
})
secretStoreHooks.after('add', (secret: Secret)=>{
    // Do something after adding a secret
})
secretStoreHooks.error('add', (secret:Secret)=>{
    // Do something if an error occurs
})
```

#### B. React

>[!Note]
> Using the provider's hooks is always preferred over the store's hooks. The store's hooks are meant to be used in a Provider context.

To use the secret store in a React component, you can use `@tanstack/react-store` with the exported `secretsStore`.

```typescript jsx
import { useStore } from "@tanstack/react-store";
import { secretsStore } from "@algorandfoundation/secret-store";

export function SecretList() {
  const secrets = useStore(secretsStore, (state) => state.secrets);

  return (
    <ul>
      {secrets.map((s) => (
        <li key={s.id}>{s.name}</li>
      ))}
    </ul>
  );
}
```

## Supported Secret Types

- `algo25`: Algorand 25-word mnemonic.
- `bip39`: BIP39 mnemonic standard.
- `intermezzo`: Tokens for Intermezzo vaults.
- `pera`: Pera Wallet specific tokens.
- `custom`: any string is valid but does not gaurantee compatibility with other extensions

## Tips & Best Practices

- **Security First**: Always ensure the `value` of a `Secret` is handled with care. Consider using non-exportable keys where possible (setting `value` to `null`).
- **Unique Identifiers**: Use stable and unique `id`s for secrets to prevent accidental overwrites or removal of the wrong keys.
- **Metadata**: Leverage the `metadata` field to store non-sensitive information like creation dates, provider-specific metadata, etc.
- **Validation**: Validate secret formats before adding them to the store to ensure compatibility with your cryptographic operations.