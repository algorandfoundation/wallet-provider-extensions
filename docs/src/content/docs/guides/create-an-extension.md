---
title: "Create an extension"
description: Define, implement, and register a custom extension on the wallet provider.
sidebar:
  order: 11
---

This guide shows you how to add a new capability to the provider by writing your own extension. As a working example we build a logger that records wallet activity.

If you want the reasoning behind the patterns used here, read [Architecture](/concepts/architecture/) first. This page sticks to the steps.

## 1. Define the extension types

An extension contributes two things: **state** (data it manages) and an **API** (methods to interact with that state). Define both as interfaces, plus a combined shape:

```typescript
export interface LoggerState {
  logs: string[];
}

export interface LoggerApi {
  log: (message: string) => void;
  clear: () => void;
}

export interface LoggerExtension extends LoggerState {
  logger: LoggerApi;
}
```

## 2. Implement the extension function

An extension is a plain function with the signature `(provider, options) => api`. It runs once when the provider is constructed, and whatever it returns is merged onto the provider instance:

```typescript
import { Store } from "@tanstack/store";
import type { Provider, ExtensionOptions } from "@algorandfoundation/wallet-provider";

const store = new Store<LoggerState>({ logs: [] });

export const loggerExtension: (
  provider: Provider,
  options: ExtensionOptions,
) => LoggerExtension = () => ({
  get logs() {
    return store.state.logs;
  },
  logger: {
    log: (message: string) => {
      store.setState((state) => ({
        logs: [...state.logs, `${new Date().toISOString()}: ${message}`],
      }));
    },
    clear: () => {
      store.setState(() => ({ logs: [] }));
    },
  },
});
```

Two details matter here:

- **State is exposed as a live getter**, not a copied value. A getter reads the store on every access, so it can never go stale.
- **Mutations replace state, they never edit it in place.** `setState` builds a new object from the old one. See [Provider](/concepts/provider/) for why.

## 3. Register your options namespace

If your extension needs configuration (most do, at minimum an injected store), register a namespace on the shared `ExtensionOptions` interface with module augmentation. Every extension's registration merges into the one options type, so app developers get completion and type checking on the whole options bag — a typo like `{ keystroe: … }` or an unknown field inside a namespace is a compile error at the composition root.

The workspace uses a **two-level registry**: the namespace is a _named, exported interface_ (`<Domain>Namespace`) that the core package registers once, and that platform or bridge packages **augment** with their own fields. That way `options.logs` stays one typed block whichever platform or bridges the application installs:

```typescript
import type { Store } from "@tanstack/store";

/** The `options.logs` namespace. Bridges augment this interface. */
export interface LogsNamespace {
  /** The domain's injected store, created by the application. */
  store?: Store<LoggerState>;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    logs?: LogsNamespace;
  }
}
```

A package layering on top (say, a remote telemetry sink) adds its fields to the _core's_ interface instead of registering `logs` a second time — two registrations of the same key with different types is a TypeScript error:

```typescript
declare module "@my-org/logger" {
  interface LogsNamespace {
    endpoint?: string;
  }
}
```

Keep the namespace optional on `ExtensionOptions`. Providers composed without your extension share the same registry and should still type-check. Your own `LoggerOptions extends ExtensionOptions` type may narrow the key to required when the extension cannot run without it (the keystore does this for `options.keystore`).

This is exactly how the workspace packages are wired: `@algorandfoundation/keystore-core` registers `KeyStoreNamespace`, and `keystore-node`/`keystore-web`/`react-native-keystore` augment it with `metadataPath`, `indexedDB`, `authentication`, and so on; `logs`, `provider-migrations`, and every domain core (`AccountsNamespace`, `IdentitiesNamespace`, `PasskeysNamespace`, `CredentialsNamespace`, `ConnectionsNamespace`) follow the same shape.

## 4. Use the extension in a provider

Compose it like any other extension:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { loggerExtension } from "./logger";

const MyProvider = Provider.withExtensions([loggerExtension]);
const provider = new MyProvider({ id: "my-app", name: "My Application" });

provider.logger.log("wallet initialized");
console.log(provider.logs); // ["2026-01-01T00:00:00.000Z: wallet initialized"]
```

## Rules that keep extensions composable

Hold your extension to these and it will compose cleanly with everything else in the ecosystem:

- **Take your store from your options namespace, never create private ones.** A store hidden inside a closure cannot be persisted, tested, or observed from outside. (The logger above keeps a module-level store for brevity; a production extension should accept it via `options.logs.store`.)
- **One domain, one namespace, on both sides.** Read configuration from `options.<domain>` (plural, e.g. `options.accounts`) and return your API under the singular key, so it lands at `provider.<singular>.store` (e.g. `provider.account.store`) next to the reactive `provider.<plural>` getter.
- **Return only what you contribute.** Never `return { ...provider, … }`: the provider merges your object's _own property descriptors_, so spreading the provider copies its reactive getters as frozen values. If you extend another extension's namespace object (`provider.account`), spread that object only: `return { account: { ...provider.account, remote } }`.
- **Named exports only.** Export `WithX` by name; the packages in this workspace ship no default exports.
- **Write only to your own domain's store.** Reading other domains' stores is fine; writing to them is another extension's job.
- **Effect first, mutation last.** Perform the side effect (network call, deep link, keychain access), then commit the outcome in one `setState`.
- **Extensions apply in order.** If you depend on the API of another extension, document the required ordering: `withExtensions([withKeys, withAccounts])` gives `withAccounts` access to everything `withKeys` contributed.

## Extensions that expose no API

Not every extension returns methods. A **bridge** subscribes to one store and feeds another. For example, a watcher that routes identity keys from the keystore into an identities store:

```typescript
export const withIdentityWatcher: Extension<object> = (provider, options) => {
  const keys = options.keystore.store;
  const identities = options.identities.store;

  keys.subscribe(() => {
    const identityKeys = keys.state.keys.filter((k) => k.metadata?.context === 1);
    identities.setState(() => ({
      identities: identityKeys.map((k) => createKeyIdentity(k)),
    }));
  });

  return {}; // nothing merged, the store mutations are the whole capability
};
```

Nobody ever calls a method on this extension, yet every subscriber of the identities store reacts to its writes. The store is the interface.

## Related

- [Compose a provider](/guides/compose-a-provider/)
- [Add a new account or identity type](/guides/add-account-types/)
- [Provider](/concepts/provider/)
