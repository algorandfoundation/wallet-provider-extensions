/**
 * The keystore **daemon**: an OWS-backed keystore published over a WebSocket.
 *
 * Custody stays where it belongs. The seed lives in the Open Wallet Standard
 * vault, which authenticates every material-touching call and signs; this
 * process owns no key material at all. What it adds is *reach*: the same
 * `KeyStoreAPI` the vault answers is published over a WebSocket, so a consumer
 * elsewhere — a wallet, a web page, another service — can drive it with the
 * ordinary remote engine.
 *
 * Nothing here is OWS-specific, which is the point: swap `createOwsKeyStore`
 * for `createNodeKeyStore` and the daemon serves the OS keychain instead, with
 * the consumer none the wiser.
 *
 * Run it with:
 * ```sh
 * pnpm --filter node-keystore-remote-example daemon
 * ```
 */

import {
  createKeyStoreWebSocketServer,
  createOwsKeyStore,
  resolveOwsBinding,
  type KeyStoreState,
  type OwsBinding,
} from "@algorandfoundation/keystore-node";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

import { createFakeOwsVault } from "./vault.ts";

/** The credential the vault expects; a real deployment uses an `ows_key_…` token. */
const PASSPHRASE = process.env["OWS_PASSPHRASE"] ?? "example-credential";

/** Where to listen. `0` asks the OS for a free port. */
const PORT = Number.parseInt(process.env["KEYSTORE_WS_PORT"] ?? "7413", 10);

/** Reactive state store — mirrors the vault's accounts as UI-safe metadata. */
const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

/**
 * Hooks make the daemon a *policy* point, not just a pipe: every operation a
 * remote consumer asks for passes through here first. This one only logs, but
 * a `before` hook that throws is a refusal the consumer receives verbatim.
 */
const hooks = new Hook.Collection();
hooks.before("sign", (options: { args?: unknown[] }) => {
  const [id] = (options.args ?? []) as [string];
  console.log(`  → remote sign request for ${id}`);
});
hooks.error("sign", (error: Error) => {
  console.log(`  ✗ refused: ${error.message}`);
  throw error;
});

/** The real OWS access layer, or the in-memory stand-in for a machine without OWS. */
const binding: OwsBinding =
  process.env["OWS_REAL"] === "1"
    ? await resolveOwsBinding()
    : createFakeOwsVault({ passphrase: PASSPHRASE, wallets: ["agent-wallet"] });

const keystore = createOwsKeyStore({ store, hooks, binding, passphrase: PASSPHRASE });

async function main(): Promise<void> {
  await keystore.ready;
  console.log(`Custodian: OWS (${(await keystore.binding).kind})`);
  for (const key of store.state.keys) {
    console.log(`  account ${key.id}  ${String(key.metadata?.["address"]).slice(0, 16)}…`);
  }

  const server = createKeyStoreWebSocketServer({ keystore, store, port: PORT });
  const url = await server.listen();
  console.log(`keystore RPC listening on ${url}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = (): void => {
    console.log("\nShutting down…");
    void server.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
