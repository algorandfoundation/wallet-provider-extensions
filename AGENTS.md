# Engineering Principles

This document outlines the architectural and engineering principles for the Wallet Provider Extensions project.

## Core Concepts

- **Stores**: Lists of information with a collection of pure interfaces. Stores should be treated as the single source of truth for specific data domains.
- **Provider**: A context that can be extended with Extensions. It serves as the primary integration point for the application. It can be used either composed or concretely.
- **Extensions**: Scoped to a single store but can integrate with other stores if available. Extensions encapsulate logic and expose a high-level API to the Provider.
- **Hooks**: A mechanism for intercepting and modifying the behavior of API methods. Hooks allow for before-and-after introspection and manipulation of data without altering the core method logic.
- **Options**: `ProviderOptions` and `ExtensionOptions` are passed into the provider and extensions respectively to configure their behavior.

## Package and Namespace Conventions

- **Store Packages**: Each store should have its own package with a name following the pattern `@algorandfoundation/<domain>-store`. The package should contain the store's implementation and any necessary dependencies. It should be located at `<domain>/store` to align with its namespace
- **Extension Packages**: Each extension should have its own package with a name following the pattern `@algorandfoundation/<domain>-<extension-name>-extension`. The package should contain the extension's implementation and any necessary dependencies.
- **Namespaces**: Namespaces should be used to organize related types and interfaces within a Provider instance. All namespaces are scoped to a `<domain>`, for example, the Provider instance will have a `account.store` when it includes the AccountStoreExtension

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

## Provider Usage

Providers can be used in two primary ways:

### Composed

```typescript
const ItemProvider = Provider.withExtensions([WithItem])
```

### Concrete

```typescript
class ItemProvider extends Provider {
    static EXTENSIONS = [WithItem]
    items!: string[]
    api: {item: ItemApi}
}
```

When constructing the class, it accepts options for the provider and each extension:

```typescript
const provider = new ItemProvider({
    id: "global-identity",
    name: "Friendly Name"
    }, {
        items: { store: itemStore, hooks: itemHooks }
})
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
export function addItem({ store, item }: { store: Store<ItemState>, item: Item }) {
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
provider.item.hooks.before('add', () => {
    console.log('About to add item');
});
```
