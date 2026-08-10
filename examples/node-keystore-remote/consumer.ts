/**
 * The remote **consumer**: a separate process that drives the daemon's keystore
 * over a WebSocket as if it owned it.
 *
 * Nothing in this file knows what the daemon is made of — OWS, an OS keychain,
 * something else entirely. It composes a `Provider` with the remote keystore
 * extension and from then on it is ordinary application code: read
 * `provider.keys`, call `sign`. This is the same code a wallet UI or a web page
 * would run; only the transport's URL differs.
 *
 * The keystore is **namespaced**: mounting it at `rpc.ows` puts it at
 * `provider.key.rpc.ows`, which is what lets a consumer hold several keystores
 * at once — a local one at `provider.key.store` plus one named service per
 * daemon it talks to.
 *
 * It also shows the two things a remote boundary must not blur:
 *
 * - the **credential** travels per operation, in the call's context, so the
 *   daemon can authenticate each request rather than trust the connection;
 * - a **denial** arrives as a denial — the vault's canonical error code reaches
 *   the caller intact instead of being softened into a failure to sign.
 *
 * Run it (with the daemon already running) with:
 * ```sh
 * pnpm --filter node-keystore-remote-example consumer
 * ```
 */

import { createPublicKey, verify as nodeVerify } from "node:crypto";

import type { Key, KeyStoreState } from "@algorandfoundation/keystore-node";
import {
  createRemoteKeyStore,
  createWebSocketTransport,
  withRemoteKeyStoreAt,
} from "@algorandfoundation/keystore-remote";
import { Provider } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";

/** Where the daemon listens, and the credential to present to the vault. */
const URL = process.argv[2] ?? process.env["KEYSTORE_WS_URL"] ?? "ws://127.0.0.1:7413";
const PASSPHRASE = process.env["OWS_PASSPHRASE"] ?? "example-credential";

/** Reactive state store — kept hydrated by the daemon's state pushes. */
const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

/** The remote engine: a drop-in keystore whose custodian is another process. */
const keystore = createRemoteKeyStore({
  store,
  transport: createWebSocketTransport({ url: URL }),
});

/**
 * The provider is composed exactly as it would be with an in-process engine —
 * except the keystore is given a name of its own, so it can share the provider
 * with other keystores. The already-connected engine is injected; drop
 * `api.keystore` and pass the `transport` in the block to have the extension
 * open it.
 */
const RemoteProvider = Provider.withExtensions([withRemoteKeyStoreAt("rpc.ows")]);
const provider = new RemoteProvider(
  { id: "remote-consumer", name: "Remote Consumer" },
  { remote: { "rpc.ows": { store } }, api: { keystore } },
);

/** The vault, reached by its name on the provider. */
const vault = provider.key.rpc.ows;

/** Hex-encodes bytes for readable output. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies a signature against the account's own address.
 *
 * A custodian that only signs has no verification operation — and should not
 * need one. The address is public, so the consumer checks the signature itself
 * rather than asking the daemon to vouch for it.
 */
function verifyLocally(account: Key, message: Uint8Array, signature: Uint8Array): boolean {
  const address = String(account.metadata?.["address"]);
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(address, "hex").toString("base64url") },
    format: "jwk",
  });
  return nodeVerify(null, message, publicKey, signature);
}

async function main(): Promise<void> {
  console.log(`Connecting to ${URL}…`);
  await keystore.ready;

  // The daemon pushed its state on connect: the provider's reactive `keys` and
  // `algorithms` describe a keystore living in another process.
  console.log(`Capabilities: ${(provider.algorithms ?? []).map((a) => a.algorithm).join(", ")}`);
  console.log("Remote accounts:");
  for (const key of provider.keys) {
    console.log(`  ${key.id}`);
    console.log(`    chain ${key.metadata?.["chain"]}  address ${key.metadata?.["address"]}`);
  }

  const account = provider.keys[0];
  if (!account) throw new Error("the daemon exposes no accounts");

  // 1. Sign remotely. The credential rides along in the per-operation context,
  //    so the custodian authenticates this request, not the connection.
  const message = new TextEncoder().encode("hello from a remote consumer");
  const signature = await vault.sign(account.id, message, "message", {
    passphrase: PASSPHRASE,
    encoding: "utf8",
  });
  console.log(`\nSignature: ${toHex(signature)}`);
  console.log(
    `Verified locally against the account address: ${verifyLocally(account, message, signature)}`,
  );

  // 2. Present the wrong credential: the custodian's denial must reach us as a
  //    denial, with its canonical code intact.
  try {
    await vault.sign(account.id, message, "message", { passphrase: "wrong" });
    console.log("\nUnexpected: the vault accepted a bad credential");
  } catch (error) {
    console.log(`\nDenied, as it should be: ${(error as Error).message}`);
  }

  await keystore.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
