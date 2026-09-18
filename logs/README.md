# @algorandfoundation/logs

A lightweight, generic log store. It captures messages with levels, timestamps, and optional metadata in a plain `@tanstack/store` `Store<LogStoreState>` that application code can create, read, and subscribe to directly. It runs fully standalone, using pure store functions (`addLog`, `removeLog`, `getLog`, `clearLogs`) over that store, and it also ships first-class support for the Algorand Wallet Provider via the `WithLogs` extension, which works with zero configuration. Both usage modes are equal citizens of the API.

## Features

- Standalone by design: log state lives in a plain `Store<LogStoreState>` your application owns, driven by pure store functions.
- First-class Provider support: `WithLogs` adds a `log` namespace (`info`, `warn`, `error`, `debug`, `trace`, `clear`) and exposes `logs` on provider state, requiring zero configuration.
- Minimal overhead with predictable state transitions powered by `@tanstack/store`.
- Framework-agnostic: works in Node.js, browsers, and with any UI framework.

## Installation

```bash
npm install @algorandfoundation/logs
```

## Usage

### 1. Register the Extension with a Provider

```ts
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithLogs } from "@algorandfoundation/logs";

// 1) Create a provider with the Log Store extension
const MyProvider = Provider.withExtensions([WithLogs]);
const provider = new MyProvider({ id: "my-provider", name: "My Wallet" });

// 2) Emit logs through the provider API
provider.log.info("Initialized wallet", { scope: "init" });
provider.log.warn("Low balance warning", { account: "ABC123" });
provider.log.error("Operation failed", { errorId: "XYZ" });

// 3) Read logs from provider state (newest first)
console.log(provider.logs);
// Example entry shape:
// {
//   id: string,
//   context?: string,
//   timestamp: Date,
//   level: LogLevel, // "info" | "warn" | "error" | "debug" | "trace"
//   message: string,
//   metadata?: Record<string, unknown> // { scope: "init" } for the first call above
// }

// 4) Clear all logs
provider.log.clear();
```

### 2. Standalone: Pure Store Functions

The log state is just a `Store<LogStoreState>`. Create one yourself and drive it with the exported store functions; no Provider required.

```ts
import { Store } from "@tanstack/store";
import { addLog, getLog, clearLogs, type LogStoreState } from "@algorandfoundation/logs";

// 1) Create a store your application owns
const store = new Store<LogStoreState>({ logs: [] });

// 2) Subscribe to state changes
const unsubscribe = store.subscribe(({ currentVal }) => {
  console.log("LogStore updated", currentVal.logs.length);
});

// 3) Add and read logs with the pure store functions
addLog({
  store,
  log: {
    id: "log-1",
    level: "info",
    context: "init",
    timestamp: new Date(),
    message: "Initialized wallet",
  },
});
console.log(getLog({ store, logId: "log-1" }));

// 4) Clear everything and clean up
clearLogs({ store });
unsubscribe();
```

### 3. Sharing a Store with a Provider (optional)

`WithLogs` needs no options, but you can hand it a store you own via `log.store`; the provider writes into it, and your application subscribes to it directly.

```ts
import { Store } from "@tanstack/store";
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithLogs, type LogStoreState } from "@algorandfoundation/logs";

const store = new Store<LogStoreState>({ logs: [] });

const MyProvider = Provider.withExtensions([WithLogs]);
const provider = new MyProvider({ id: "my-provider", name: "My Wallet" }, { log: { store } });

const unsubscribe = store.subscribe(({ currentVal }) => {
  console.log("LogStore updated", currentVal.logs.length);
});

provider.log.info("Initialized wallet", { scope: "init" });

// Later, when you no longer need updates
unsubscribe();
```

### 4. React Example (with @tanstack/react-store)

Pass your own store to the provider (as above) and read it with `useStore`.

```tsx
import { useStore } from "@tanstack/react-store";
import { myLogStore } from "./store"; // the Store<LogStoreState> passed to the provider

export function LogList() {
  const logs = useStore(myLogStore, (state) => state.logs);

  return (
    <ul>
      {logs.map((l) => (
        <li key={l.id}>
          <strong>[{l.level}]</strong> {l.message}
        </li>
      ))}
    </ul>
  );
}
```

## Configuration

`WithLogs` reads the `options.log` namespace (`LogNamespace`), registered on the shared `ExtensionOptions` registry so it is typed at the composition root:

| Option      | Type                   | Default           | Description                                                                   |
| ----------- | ---------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `log.store` | `Store<LogStoreState>` | fresh empty store | The reactive store the log writes to. Pass your own to subscribe from the UI. |

Every level method has the same signature, `(message, metadata?, context?)`: `metadata` is recorded on the entry (and passed to the mirrored `console.*` call), `context` names the emitting subsystem.

## Tips & Best Practices

- Use metadata to attach helpful context such as `account`, `requestId`, or `scope`.
- Consider piping `provider.logs` to your own transport (e.g., remote telemetry) if you need persistence.
- `console.*` calls are mirrored for convenience during development (`console.debug` for `debug`, etc.). In production, filter or redirect as needed.
- Other extensions treat the log as optional: they call `provider.log?.info(...)`, so mount `WithLogs` before them in the extensions array.

## License

Apache-2.0
