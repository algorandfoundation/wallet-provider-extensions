---
title: "Log wallet activity"
description: Give every extension one reactive log to write to and your UI one place to read from.
sidebar:
  order: 9
---

Wallets do a lot of asynchronous work in the background: sessions reconnect, bridges reconcile, keys derive. `@algorandfoundation/logs` gives all of it one destination. It is a small extension holding a reactive list of log messages, which doubles as an in-app debug console, an audit trail, and a feed you can mirror to `console` or remote telemetry.

## Set up the extension

```typescript
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithLogs } from "@algorandfoundation/logs";
import type { LogStoreState } from "@algorandfoundation/logs";
import { Store } from "@tanstack/store";

const logStore = new Store<LogStoreState>({ logs: [] });

const MyProvider = Provider.withExtensions([WithLogs /* , the rest */]);
const provider = new MyProvider(
  { id: "my-wallet", name: "My Wallet" },
  { log: { store: logStore } },
);
```

Put `WithLogs` early in the extension list. The other extensions in this workspace detect a mounted log store on the provider and write their own diagnostics into it, but only the ones composed after it can see it.

## Write log entries

The API lives at `provider.log`, one method per level:

```typescript
provider.log.info("Wallet initialized", { scope: "init" });
provider.log.warn("Session took long to resume", { sessionId });
provider.log.error("Transaction failed", { errorId: "TX123" }, "SigningEngine");
provider.log.debug("Reconciling accounts", { count: 4 });
provider.log.trace("Hook fired", { hook: "generate" });
```

The optional second argument is structured metadata, the optional third is a `context` string that names the subsystem. Each entry is stored as:

```typescript
export interface LogMessage {
  id: string;
  context?: string;
  timestamp: Date;
  level: LogLevel; // "info" | "warn" | "error" | "debug" | "trace"
  message: string;
  metadata?: Record<string, unknown>;
}
```

Every entry is also mirrored to the `console` method of the same name (`console.debug` for `debug`, and so on), so the log doubles as a development console without extra wiring.

## Read and react

`provider.logs` is a live getter, and the store subscribes like any other domain:

```typescript
console.log(provider.logs.map((l) => `[${l.level}] ${l.message}`));

logStore.subscribe(() => {
  const latest = logStore.state.logs[0]; // newest first
  if (latest?.level === "error") reportToTelemetry(latest);
});

provider.log.clear(); // start fresh
```

Because the log is just a store, an in-app "developer console" screen is a subscription and a list component, nothing more.

## Related

- [Create an extension](/guides/create-an-extension/) builds a logger from scratch to teach the extension pattern; this package is the production version of that idea.
- [Provider](/concepts/provider/) for the store rules the log follows.
