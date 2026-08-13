# `@algorandfoundation/provider-migrations`

Revision-tracked data migrations for Wallet Provider extensions.

Packages in this repository publish breaking changes often. When a breaking
change alters the shape of _persisted_ data, this engine lets the package ship a
versioned migration alongside it, so consuming applications converge instead of
losing data.

## Using it in an application

`WithMigrations` must be **first** in the extensions array, so later extensions
can register with it.

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithMigrations, keyValueLedger } from "@algorandfoundation/provider-migrations";

const MyProvider = Provider.withExtensions([WithMigrations, WithKeyStore]);

const provider = new MyProvider(
  { id: "wallet", name: "Wallet" },
  {
    migrations: {
      ledger: keyValueLedger({
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
      }),
    },
    keystore: { store, hooks },
  },
);

await provider.migrations.ready;
```

If `WithMigrations` is absent, `provider.migrations` is `undefined` and every
`register` call is a no-op. That is the opt-in mechanism.

Pass `migrations: { autoRun: false }` to defer the run, then call
`provider.migrations.run()` yourself — useful when migrations must wait behind a
splash screen or an unlock.

## Adding a migration to a package

Keep revisions in `src/migrations/`, one file per revision, and maintain a typed
barrel.

```typescript
// src/migrations/0001-add-scheme-field.ts
import type { Migration } from "@algorandfoundation/provider-migrations";
import type { MyStorage } from "../storage/driver.ts";

export const migration: Migration<MyStorage> = {
  id: 1,
  name: "add-scheme-field",
  up: (storage) => {
    for (const record of readAll(storage)) {
      if (record.scheme) continue; // already migrated
      write(storage, { ...record, scheme: "v2" });
    }
  },
};
```

```typescript
// src/migrations/index.ts
import type { Migration } from "@algorandfoundation/provider-migrations";
import type { MyStorage } from "../storage/driver.ts";
import { migration as r0001 } from "./0001-add-scheme-field.ts";

export const migrations: readonly Migration<MyStorage>[] = [r0001];
```

Then register from your extension, using the optional-dependency probe:

```typescript
provider.migrations?.register({
  module: "@algorandfoundation/my-package",
  context: () => storage,
  migrations,
});
```

Take this package as a **devDependency plus an optional peerDependency**. Only
types are imported, and `verbatimModuleSyntax` erases them, so there is no
runtime dependency.

## Migrations in your own application extensions

Nothing about the engine is specific to packages in this repository. An
application that writes its own extensions registers them exactly the same way —
`register` accepts any module id and any context type.

```typescript
import type { Migration } from "@algorandfoundation/provider-migrations";
import { migrations } from "./migrations/index.ts";

export const WithWatchedAccounts = (provider: any, options: MyOptions) => {
  const storage = options.watched.storage;

  provider.migrations?.register({
    module: "com.mycompany.wallet/watched-accounts",
    context: () => storage,
    migrations,
  });

  return {
    /* your API */
  };
};
```

Three requirements:

- `WithMigrations` is **first** in `EXTENSIONS`, and your extension comes after
  it. Otherwise `provider.migrations` does not exist yet when your extension
  runs, `register` no-ops, and your migrations silently never run.
- Your `module` id is unique and stable. It is the ledger key, so renaming it
  later makes the engine believe the module has never migrated. A reverse-DNS
  string or your package name works; just do not reuse an id a library already
  claims.
- Applications take this package as a normal **dependency**, not the
  devDependency + optional peer arrangement libraries use — an application
  imports `WithMigrations` and a ledger as values, not just types.

### Ordering is positional

Modules run sequentially in registration order, which is extension order. There
is no declared dependency between modules. If one of your migrations must run
after a library's — say it reads records the keystore migration reshapes — place
your extension after that library's in the array. Getting this wrong produces no
error, so it is worth a comment next to the array.

### Baselining over an existing migration system

If you already migrate data with your own mechanism, read this before adopting.

An absent ledger entry means revision zero, so the engine runs **every** revision
a module declares. Port your existing migrations and the first launch re-applies
all of them to data they have already been applied to. That is safe if each is
idempotent — which the engine requires anyway — but hand-rolled migrations often
are not, so do not assume it.

The ledger is yours, and `write` is public, so stamp it before constructing the
provider:

```typescript
const ledger = keyValueLedger(kv);
const state = await ledger.read();

if (!state["com.mycompany.wallet/watched-accounts"]) {
  const alreadyApplied = readMyLegacyMigrationState(); // your current mechanism
  if (alreadyApplied > 0) {
    await ledger.write("com.mycompany.wallet/watched-accounts", {
      id: alreadyApplied,
      name: "baseline-from-legacy-migrations",
      appliedAt: new Date().toISOString(),
    });
  }
}

const provider = new MyProvider(config, { migrations: { ledger } /* ... */ });
await provider.migrations.ready;
```

Number your ported revisions to match the sequence your old system used and the
engine resumes exactly where it left off. A fresh install has no legacy state,
gets no baseline entry, and correctly runs everything from revision 1.

Run `assertIdempotent` over each ported revision regardless. Migrations written
against a run-once mechanism are the most likely in any codebase to break when
run twice, and the baseline above is the only thing standing between them and a
re-run.

## Rules for writing a migration

1. **Idempotent.** Running twice must converge to the same state. Assert it with
   `assertIdempotent` from `@algorandfoundation/provider-migrations/testing`.
2. **A no-op on empty data.** A fresh install runs every revision from zero.
3. **Copy, verify, delete — never move.** Write the new location, verify it reads
   back, and only then delete the old one. A crash then leaves both copies and
   re-running converges.
4. **Never put key material in an error message.** Failures are recorded verbatim
   in the report.
5. **Use `utils.secrets` for material in flight**, never a bare local variable.

## Guarding revision ids

There is no generator. Assert your own barrel in a unit test:

```typescript
import { validateMigrations } from "@algorandfoundation/provider-migrations";
import { migrations } from "./index.ts";

it("has a valid manifest", () => {
  expect(() => validateMigrations(migrations, "@algorandfoundation/my-package")).not.toThrow();
});
```
