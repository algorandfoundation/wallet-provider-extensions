---
title: "Architecture"
description: Why the system is built from providers, extensions, and domain stores.
sidebar:
  order: 1
---

The whole system rests on one idea: a wallet is a set of independent **capabilities** (keys, accounts, identities, sessions) composed onto a **provider**, with all state living in **domain stores** that the application creates and hands in. The provider does not own state; it operates on stores you give it.

This page explains the three building blocks and the reasoning behind them. If you just want to wire things up, jump to [Compose a provider](/guides/compose-a-provider/).

## The three building blocks

### The Provider: a composition root

A `Provider` holds identity (`id`, `name`, `icon`, `uri`) and merged configuration, and nothing else. `Provider.withExtensions([...])` produces a specialized class from a list of extensions, and TypeScript infers the combined surface, so everything an extension contributes shows up fully typed on the instance.

### Extensions: capability modules

An `Extension` is a plain function `(provider, options) => api`. When a provider is constructed, each extension runs once and its returned object is merged into the instance. This is the same plugin pattern OctoKit uses: no inheritance hierarchy, no god-object wallet class, just small, independently testable functions, each responsible for one domain of behavior.

Extensions apply in order, and each one receives the provider as it exists so far. That makes composition the dependency mechanism: `withExtensions([withKeys, withAccounts])` gives `withAccounts` access to everything `withKeys` contributed.

### Domain stores: injected reactive state

State is not a single blob and it is not created inside the provider. The application creates one store per domain and passes each one in under that domain's key in the options. Every domain is namespaced symmetrically: configuration goes in at `options.<plural>` (`options.accounts`) and the interface comes out at `provider.<singular>.store` (`provider.account.store`) next to a reactive `provider.<plural>` getter.

### The options registry: one typed bag

The `options` parameter is a single `ExtensionOptions` interface that every package extends through declaration merging. Each domain core registers a **named namespace interface** (`KeyStoreNamespace`, `AccountsNamespace`, `IdentitiesNamespace`, …) under its key, and the platform or bridge packages that layer on top augment _that_ interface with their extras (`keystore.metadataPath` from `keystore-node`, `accounts.keystore.autoPopulate` from the accounts↔keystore bridge). The composition root therefore sees one fully typed block per domain: an unknown namespace or a misspelled field is a compile error, whichever platform the application installs.

## The contract between provider and state

Three rules govern how state moves through the architecture. Everything else follows from them.

**Rule 1: state lives in domain stores, injected from outside.** Because stores exist independently of the wallet layer, the same stores can be persisted, hydrated on a server, inspected in devtools, shared with background services, or replaced wholesale in tests. None of those contexts needs a provider in scope.

**Rule 2: state on the interface is a convenience.** Properties like `provider.keys` are live reads of the underlying store. They are not a second copy of the data; the store remains the single source of truth and is what reactive consumers subscribe to.

**Rule 3: interface methods are store mutations with side effects.** A method like `connect()` performs its side effect (open a session, hit the network, follow a deep link) and then commits the outcome to the relevant store with `setState`. The UI never mutates wallet state directly and never polls. It invokes commands and reacts.

## Why this works so well reactively

Wallet state is asynchronous and event-driven by nature. Sessions drop, accounts change from a mobile approval or a deep link, keys are derived and identities restored from a backup. A UI cannot poll for any of this; it has to react. The architecture turns that requirement into structure:

- **Reactivity follows domain boundaries.** A component watching identities is never woken by a session reconnect. The granularity of your subscriptions matches the granularity of your state by construction, not by careful selector discipline over one giant object.
- **State escapes the wallet layer.** The stores are yours. The provider is a controller over them, not a silo around them.
- **One source of truth per domain.** Imperative code reads snapshots off the interface; reactive code subscribes to the store. Both always agree because they are the same data.
- **A single, auditable write path.** Every mutation goes through an extension method: effect first, `setState` last. When something changes unexpectedly, there is exactly one layer to look at.
- **Framework-agnostic by default.** TanStack Store ships adapters for React, Vue, Solid, Svelte, and Angular. The contract is plain stores rather than framework hooks, so one wallet core serves every framework.

## The two perspectives

**If you build apps**, the provider is a typed command surface over state you already own. You create a store per domain, pass each in under its namespace, and subscribe exactly where you render. You never mutate wallet state and never poll for it: you call a command and your subscriptions fire.

**If you build extensions**, you implement one domain as a self-contained module: claim your namespace from the injected options, return your API under the same key, expose live getters for convenient reads, and shape every operation as a command. See [Create an extension](/guides/create-an-extension/) for the concrete steps.

One sentence for both: domain stores make wallet state reactive, portable, and inspectable; extensions make wallet behavior modular and typed; the provider is the thin seam that binds them together.

## Further reading

- [Provider](/concepts/provider/) explains how data moves between stores and why the full wallet state can be projected as a single DID document.
- The [wallet-provider repository](https://github.com/algorandfoundation/wallet-provider) hosts the base `Provider` and its architectural decision records.
