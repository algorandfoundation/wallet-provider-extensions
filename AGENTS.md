# Engineering Principles

This document outlines the architectural and engineering principles for the Wallet Provider Extensions project.

## Core Concepts

- **Stores**: Lists of information with a collection of pure interfaces. Stores should be treated as the single source of truth for specific data domains.
- **Provider**: A context that can be extended with Extensions. It serves as the primary integration point for the application. It can be used either composed or concretely.
- **Extensions**: Scoped to a single store but can integrate with other stores if available. Extensions encapsulate logic and expose a high-level API to the Provider.
- **Hooks**: A mechanism for intercepting and modifying the behavior of API methods. Hooks allow for before-and-after introspection and manipulation of data without altering the core method logic.
- **Options**: `ProviderOptions` and `ExtensionOptions` are passed into the provider and extensions respectively to configure their behavior. `ExtensionOptions` is a declaration-merged registry: every domain registers its `options.<domain>` namespace on it (see [Options Registry](#options-registry)).

## File Naming Conventions

To maintain consistency across the codebase, follow these naming conventions:

- `store.ts`: Contains all store operations (mutations, queries) for any extension or store. Can grow into a `store/` folder with a barrel file for larger features.
- `extension.ts`: Defines the extension interfaces and the implementation of the extension logic. Can grow into an `extension/` folder with a barrel file for larger features.
- `errors.ts`: Contains error collections and custom error classes for a specific module. Classes are allowed for Errors.
- `types.ts`: Contains only TypeScript interfaces and types used across the codebase. This file should not contain any executable code. Can grow into a `types/` folder with a barrel file for larger features.

## Development Standards

- **ESM Only**: All modules must support ESM only and align with Node.js conventions to support unbundled development.
- **Pure Methods**: Prefer pure methods over classes. Avoid stateful implementations whenever possible to ensure predictability and ease of testing. Classes are allowed for custom error implementations.
- **Documentation**: Every public-facing method or interface must have Typedoc comments, including clear examples.
- **Strict Mode**: `strict` mode must be enabled in `tsconfig.json` to ensure type safety.
- **Erasable Syntax**: `erasableSyntaxOnly` must be enabled in `tsconfig.json` to ensure compatibility with various build tools and to prepare for future JavaScript features.
- **Named Exports Only**: Packages export `WithX` and their store functions/types by name; no `export default` from package barrels.
- **Barrel Documentation**: Every package `src/index.ts` opens with a `@module default` / `@packageDocumentation` Typedoc block describing the package, what it mounts, and how it is used standalone.

## Naming Conventions

- **Extensions** are `With<DomainPlural>` (`WithAccounts`, `WithIdentities`, `WithPasskeys`, `WithCredentials`, `WithConnections`, `WithKeyStore`, `WithLogs`, `WithMigrations`). A core package and its meta package export the same name; the meta one composes the bridges.
- **Bridges** are `With<Domain><Dependency>` (`WithAccountsKeystore`, `WithIdentitiesConnections`). Vendor-specific bridges may prefix the vendor instead (`WithIntermezzoCredentials`, as a `WithVaultKeystore` would).
- **Surface**: configuration is read from `options.<plural>`; the API is mounted at `provider.<singular>.store` (`addX`, `removeX`, `getX`, `clear`, `hooks`), bridges add `provider.<singular>.remote` / `.<vendor>`, and reactive state is exposed as `provider.<plural>`.

## Options Registry

Each domain owns one **named namespace interface** that it registers on the shared `ExtensionOptions`:

```typescript
// <domain>/core/src/types.ts
export interface ItemsNamespace {
  store?: Store<ItemState>;
  hooks?: HookCollection<any>;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    items?: ItemsNamespace;
  }
}
```

Platform and bridge packages **augment the core's interface** for their extras rather than registering the key a second time (two registrations of one key are a TypeScript error):

```typescript
// <domain>/keystore-extension/src/types.ts
declare module "@algorandfoundation/items-core" {
  interface ItemsNamespace {
    keystore?: { autoPopulate?: boolean };
  }
}
```

The result is one typed `options` bag at the composition root: unknown namespaces and unknown fields are compile errors.

## Extension Return Values

An extension returns **only the surface it contributes**. The Provider merges the returned object's own property descriptors onto the instance, so `return { ...provider, … }` copies reactive getters as frozen snapshots. To add to another extension's namespace object, spread that object only: `return { item: { ...provider.item, remote } }`.

## Provider Usage

Providers can be used in two primary ways:

### Composed

```typescript
const ItemProvider = Provider.withExtensions([WithItem]);
```

### Concrete

```typescript
class ItemProvider extends Provider {
  static EXTENSIONS = [WithItem];
  items!: string[];
  api: { item: ItemApi };
}
```

When constructing the class, it accepts options for the provider and each extension:

```typescript
const provider = new ItemProvider(
  {
    id: "global-identity",
    name: "Friendly Name",
  },
  {
    items: { store: itemStore, hooks: itemHooks },
  },
);
```

## Extension Dependencies

An extension can depend on another extension. For example, many extensions could leverage a log extension. Extensions can depend on each other in three ways:

- **Optional**: The extension uses a dependency if available on the provider, but functions without it.
- **Incremental**: The extension provides additional interfaces if a dependency is present.
- **Hard dependency**: The extension requires another extension to be present to function correctly.

## Example: Store & Extension

### `types.ts`

```typescript
export interface Item {
  name: string;
}

export interface ItemState {
  items: Item[];
}

export interface ItemApi {
  auditLog?(): string[];
  addItem(item: Item): Promise<Item>;
  hooks: HookCollection<any>;
}

export interface ItemExtension extends ItemState {
  item: ItemApi;
}
```

### `store.ts`

````typescript
import { Store } from "@tanstack/store";
import type { Item, ItemState } from "./types.js";

/**
 * Adds an item to the store.
 *
 * @example
 * ```typescript
 * addItem({ store, item: { name: "new item" } });
 * ```
 */
export function addItem({ store, item }: { store: Store<ItemState>; item: Item }) {
  store.setState((state) => ({
    ...state,
    items: [...state.items, item],
  }));
}
````

### `extension.ts`

```typescript
import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import { addItem } from "./store.js";
import type { ItemState, Item, ItemExtension, ItemApi } from "./types.js";

// Also possible to depend on a global store or hooks collection
//export const itemStore = new Store<ItemState>({items: []});
//export const itemHooks = new HookCollection<any>();

export const WithItem: Extension<ItemExtension> = (provider, options) => {
    // Optional configuration via options
    const itemStore = options?.items?.store ?? new Store<ItemState>({items: []});
    const itemHooks = options?.items?.hooks ?? new HookCollection<any>();

    // Incremental: Provide additional interfaces if dependencies (e.g., logger) are present
    let extended = provider.log ? {
        auditLog: itemHooks('audit', () => provider.logs.filter((m: string) => m.startsWith("algo"))
    } : {};

    return {
        item: {
            ...extended,
            addItem: async (item: Item) => {
                // Optional: Use provider's dependency if available
                provider?.log?.('adding Item', item);
                return itemHooks('add', addItem, { store: itemStore, item });
            },
            hooks: itemHooks
        } as ItemApi
    };
};
```

## Example: Hooks Usage

Hooks allow for introspection and extending behavior before or after an API call.

```typescript
// Registering a 'before' hook on the item extension
provider.item.hooks.before("add", () => {
  console.log("About to add item");
});
```
