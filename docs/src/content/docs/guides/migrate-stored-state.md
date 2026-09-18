---
title: "Migrate stored state"
description: Upgrade persisted wallet data safely across releases with revision-tracked migrations.
sidebar:
  order: 10
---

Wallet state is persisted: keys in a keychain, sessions in storage, accounts in a saved store. When a new release changes a storage shape, existing installs still hold data in the old one. `@algorandfoundation/provider-migrations` runs revision-tracked migrations at startup so every install converges on the current shape, without data loss and without manual steps.

## Set up the extension

`WithMigrations` must be the **first** extension in the array, so it is mounted before any extension that might need to register or run migrations:

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithMigrations, keyValueLedger } from "@algorandfoundation/provider-migrations";

const MyProvider = Provider.withExtensions([WithMigrations, WithKeyStore /* , the rest */]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  {
    migrations: { ledger: keyValueLedger(kvStore) },
    // ... other options
  },
);

await provider.migrations.ready; // resolves when the auto-run finishes
```

The **ledger** records which revision each module has reached, and must itself be persistent. `keyValueLedger` wraps any key-value storage you already have (localStorage on the web, MMKV on React Native, a file in Node). A module with no ledger entry is at revision 0, so a fresh install simply runs everything once.

## Define a migration

A migration is an object with a monotonically increasing `id`, a `name`, and an `up` step that receives the module's context:

```typescript
import type { Migration } from "@algorandfoundation/provider-migrations";

export const addVersionField: Migration<MyStorage> = {
  id: 1,
  name: "add-version-field",
  up: (storage) => {
    storage.updateAll((record) => ({ ...record, version: 2 }));
  },
};
```

Keep each `up` step idempotent where you can, and never delete old migrations: a user can update from any past release, and the runner needs the full path from their revision to the current one.

## Register a module

Modules register their migrations with the provider, usually from inside the extension that owns the data:

```typescript
provider.migrations?.register({
  module: "@scope/package-name",
  context: () => storageInstance,
  migrations: [addVersionField, splitKeyMetadata],
});
```

The optional chaining is deliberate. An extension should work whether or not the app composed `WithMigrations`; registration is an offer, not a requirement.

## Run and inspect

With `autoRun` (the default), pending migrations run at construction and `provider.migrations.ready` resolves with a report. You can also trigger a run explicitly:

```typescript
const report = await provider.migrations.run();
```

The runner reads the ledger, finds each module's current revision, applies every later `up` step in `id` order, and writes the new revision back after each success. The report tells you which modules moved and to where, which is worth logging on startup:

```typescript
provider.log?.info("Migrations complete", { report });
```

## Related

- [Log wallet activity](/guides/log-wallet-activity/) for somewhere to put the report.
- [Create an extension](/guides/create-an-extension/) if your extension owns persisted data worth versioning.
